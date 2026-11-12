import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fetchModelResource} from '../src/model-download.js';

const originalFetch = globalThis.fetch;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fast = {inactivityTimeoutMs: 100, retries: 1};
const encoded = text => new TextEncoder().encode(text);
try {
  let calls = 0;
  // A fetch implementation that ignores AbortSignal must still be bounded.
  globalThis.fetch = () => { calls++; return new Promise(() => {}); };
  await assert.rejects(fetchModelResource('/stalled-connection', fast), {name: 'TimeoutError'});
  assert.equal(calls, 2);

  let canceled = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoded('first')); },
      cancel() { canceled++; }
    }));
  };
  calls = 0;
  await assert.rejects(fetchModelResource('/stalled-body', fast), {name: 'TimeoutError'});
  assert.equal(calls, 2);
  assert.equal(canceled, 2);

  const progress = [];
  globalThis.fetch = async () => new Response(new ReadableStream({
    async start(controller) {
      for (const value of ['a', 'b', 'c', 'd', 'e']) {
        await sleep(30);
        controller.enqueue(encoded(value));
      }
      controller.close();
    }
  }), {headers: {'content-length': '5'}});
  const bytes = await fetchModelResource('/healthy-slow', {...fast, onProgress: (n, total) => progress.push([n, total])});
  assert.equal(new TextDecoder().decode(bytes), 'abcde');
  assert(progress.some(([n, total]) => n === 2 && total === 5), 'Progress must arrive before completion');

  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', {status: 503}); };
  await assert.rejects(fetchModelResource('/unavailable', fast), /503/);
  assert.equal(calls, 2);
  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('', {status: 404}); };
  await assert.rejects(fetchModelResource('/missing', fast), /404/);
  assert.equal(calls, 1, 'Permanent errors should fall back without retrying');
  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) throw new TypeError('network failed');
    return new Response('recovered');
  };
  assert.equal(new TextDecoder().decode(await fetchModelResource('/retry', fast)), 'recovered');
  assert.equal(calls, 2);

  const cancel = new AbortController();
  calls = 0;
  globalThis.fetch = () => { calls++; return new Promise(() => {}); };
  const pending = fetchModelResource('/cancel', {...fast, signal: cancel.signal});
  cancel.abort();
  await assert.rejects(pending, {name: 'AbortError'});
  assert.equal(calls, 1, 'User cancellation must not retry');
  await assert.rejects(fetchModelResource('/already-canceled', {signal: cancel.signal}), {name: 'AbortError'});
  assert.equal(calls, 1);

  // Exercise the actual scene loader with a fake native store. No WASM or
  // browser is needed to verify fallback, failure cleanup and cancellation.
  let source = await readFile(new URL('../src/load-model.js', import.meta.url), 'utf8');
  source = source.replaceAll('import.meta.env', JSON.stringify({BASE_URL: '/', DEV: false}));
  for (const name of ['model-download', 'model-source', 'model-file-store', 'stl-transfer', 'wasm-loader']) {
    source = source.replace(`'./${name}.js'`, JSON.stringify(new URL(`../src/${name}.js`, import.meta.url).href));
  }
  const {loadRsScene} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let disposed = 0, writes = 0;
  const runtime = {
    MjVFS: class {
      addBuffer() { writes++; }
      delete() { disposed++; }
    },
    MjModel: {from_xml_path() { return {}; }},
    MjData: class {}, mj_forward() {}
  };
  const requests = [];
  globalThis.fetch = async url => {
    requests.push(url);
    if (url.includes('.xml')) return new Response('<mujoco><mesh file="part.stl"/></mujoco>');
    if (url.includes('.gzbin')) return new Promise(() => {});
    return new Response('raw mesh');
  };
  const warn = console.warn;
  console.warn = () => {};
  try {
    await loadRsScene(runtime, null, {downloadOptions: fast});
  } finally { console.warn = warn; }
  assert.equal(requests.filter(url => url.includes('.gzbin')).length, 2);
  assert.equal(requests.filter(url => url.includes('part.stl') && !url.includes('gzbin')).length, 1);
  assert.equal(disposed, 1);

  // Cancel once the store exists and another download is waiting on its body.
  const sceneCancel = new AbortController();
  let bodyCanceled = false;
  globalThis.fetch = async url => {
    if (url.includes('.xml')) return new Response('<mujoco><mesh file="ok.stl"/><mesh file="wait.stl"/></mujoco>');
    if (url.includes('ok.stl')) return new Response('mesh');
    return new Response(new ReadableStream({cancel() {bodyCanceled = true;}}));
  };
  disposed = writes = 0;
  const loading = loadRsScene(runtime, null, {signal: sceneCancel.signal, downloadOptions: fast});
  for (let i = 0; i < 50 && writes === 0; i++) await sleep(1);
  assert(writes > 0, 'At least one file must reach native storage before cancellation');
  sceneCancel.abort();
  await assert.rejects(loading, {name: 'AbortError'});
  assert(bodyCanceled);
  assert.equal(disposed, 1, 'Cancellation must dispose the shared native store exactly once');
  const before = writes;
  await sleep(40);
  assert.equal(writes, before, 'Canceled workers must not write after cleanup');

  // A terminal download failure must cancel peers rather than waiting for
  // their own timeouts, and cleanup must run after their cancellation.
  bodyCanceled = false;
  disposed = writes = 0;
  globalThis.fetch = async url => {
    if (url.includes('.xml')) return new Response('<mujoco><mesh file="ok.stl"/><mesh file="missing.stl"/><mesh file="wait.stl"/></mujoco>');
    if (url.includes('ok.stl')) return new Response('mesh');
    if (url.includes('missing.stl')) { await sleep(5); return new Response('', {status: 404}); }
    return new Response(new ReadableStream({cancel() {bodyCanceled = true;}}));
  };
  console.warn = () => {};
  try {
    await assert.rejects(loadRsScene(runtime, null, {downloadOptions: fast}), /404/);
  } finally { console.warn = warn; }
  assert(bodyCanceled, 'A failed worker must cancel a stalled peer');
  assert.equal(disposed, 1);

  // Waiting for WASM must also be interruptible; no native store is created.
  globalThis.fetch = async () => new Response('<mujoco/>');
  const waitingCancel = new AbortController();
  const waiting = loadRsScene(new Promise(() => {}), null, {signal: waitingCancel.signal});
  await sleep(1);
  waitingCancel.abort();
  await assert.rejects(waiting, {name: 'AbortError'});
  console.log('Model downloads passed: connection/body timeouts, slow progress, bounded retries, raw fallback, abort and native-store cleanup.');
} finally {
  globalThis.fetch = originalFetch;
}

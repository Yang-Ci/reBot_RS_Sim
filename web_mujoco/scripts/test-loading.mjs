import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import loadMujoco from '@mujoco/mujoco';
import { compileRemoteWasm } from '../src/wasm-loader.js';
import {packStl} from './pack-stl.mjs';
import {gzipSync} from 'node:zlib';

const originalFetch = globalThis.fetch;
const source = 'const __PACKED_MESH_FILES__={"meshes/base_link.STL":true};\n'+(await readFile(new URL('../src/load-model.js', import.meta.url), 'utf8'))
  .replaceAll('import.meta.env', JSON.stringify({ BASE_URL: '/', DEV: false }))
  .replace("'./wasm-loader.js'", JSON.stringify(new URL('../src/wasm-loader.js', import.meta.url).href))
  .replace("'./model-file-store.js'", JSON.stringify(new URL('../src/model-file-store.js', import.meta.url).href))
  .replace("'./model-source.js'", JSON.stringify(new URL('../src/model-source.js', import.meta.url).href));
const withDownloads=source.replace("'./model-download.js'",JSON.stringify(new URL('../src/model-download.js',import.meta.url).href));
const portableSource=withDownloads.replace("'./stl-transfer.js'",JSON.stringify(new URL('../src/stl-transfer.js',import.meta.url).href));
const { loadRsScene } = await import(`data:text/javascript;base64,${Buffer.from(portableSource).toString('base64')}`);

async function checkDownloadQueue(meshSize) {
  let releaseRuntime;
  const runtime = new Promise((resolve) => { releaseRuntime = resolve; });
  const stored = new Set();
  let deleted = false;
  const fakeRuntime = {
    MjVFS: class {
      addBuffer(name) { assert(!deleted); stored.add(name); }
      delete() { deleted = true; }
    },
    MjModel: { from_xml_path() { assert.equal(stored.size, 21); return {}; } },
    MjData: class {},
    mj_forward() {}
  };
  let downloaded = 0;
  globalThis.fetch = async (url) => {
    if (url.includes('.xml')) {
      return new Response(`<mujoco>${Array.from({ length: 20 }, (_, i) => `<mesh file="part${i}.stl"/>`).join('')}</mujoco>`);
    }
    downloaded++;
    return new Response(new Uint8Array(meshSize));
  };
  const loading = loadRsScene(runtime);
  try {
    // Allow downloads to settle while deliberately holding WASM initialization.
    for (let i = 0; i < 20; i++) await new Promise(setImmediate);
    if (meshSize === 1024) assert.equal(downloaded, 20, 'small meshes should all download before WASM');
    else {
      assert(downloaded >= 6 && downloaded <= 9, `buffer must apply backpressure: ${downloaded}`);
      assert.equal(stored.size, 0);
    }
  } finally {
    releaseRuntime(fakeRuntime);
    await loading;
  }
  assert(deleted);
  assert.equal(stored.size, 21);
}

try {
  await checkDownloadQueue(1024);
  await checkDownloadQueue(4 * 1024 * 1024);

  const emptyWasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  for (const type of ['application/wasm', 'application/octet-stream']) {
    globalThis.fetch = async (_url, options) => {
      assert.notEqual(options.method, 'HEAD');
      return new Response(emptyWasm, { headers: { 'content-type': type } });
    };
    assert(await compileRemoteWasm('https://example.test/mujoco.wasm') instanceof WebAssembly.Module);
  }
  globalThis.fetch = async () => new Response('', { status: 503 });
  await assert.rejects(compileRemoteWasm('https://example.test/mujoco.wasm'), /503/);
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  await assert.rejects(compileRemoteWasm('https://example.test/mujoco.wasm', 20), /aborted/);
  globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){
    let index=0;function chunk(){controller.enqueue(emptyWasm.slice(index,index+1));index++;
      if(index===emptyWasm.length)controller.close();else setTimeout(chunk,10);}
    setTimeout(chunk,10);
  }}),{headers:{'content-type':'application/wasm'}});
  assert(await compileRemoteWasm('https://example.test/slow-but-progressing.wasm',40) instanceof WebAssembly.Module,
    'A progressing response may exceed the inactivity timeout in total');

  // Exercise the production download/file-store pipeline with real scene trees.
  const mujoco = await loadMujoco();
  globalThis.fetch = async (url) => {
    const relative = new URL(url, 'https://example.test').pathname.slice('/models/'.length);
    if(relative.endsWith('.stlp1.gzbin')) {
      const bytes=await readFile(new URL(`../../rebotarm_mujoco_rs/models/${relative.slice(0,-12)}`,import.meta.url));
      return new Response(gzipSync(packStl(bytes)));
    }
    if (relative.endsWith('.gzbin')) return new Response('', { status: 404 });
    return new Response(await readFile(new URL(`../../rebotarm_mujoco_rs/models/${relative}`, import.meta.url)));
  };
  const warn = console.warn;
  console.warn = () => {}; // These requests intentionally exercise raw-mesh fallback.
  try {
    const roots=()=>mujoco.FS.readdir('/').filter(name=>name.startsWith('rebot-model-')).sort();
    const before=roots();let reference;
    function snapshot(model,data) {
      const hash=createHash('sha256');
      // Check native collision/render geometry, inertial and joint parameters,
      // then a deterministic contact simulation. Paths differ by design.
      for(const name of ['qpos0','body_mass','body_inertia','body_ipos','body_iquat','jnt_pos','jnt_axis','jnt_range',
        'geom_pos','geom_quat','geom_size','geom_friction','geom_type','geom_bodyid','geom_dataid','mesh_vert','mesh_face']) {
        const value=model[name];assert(ArrayBuffer.isView(value),name);
        hash.update(name).update(new Uint8Array(value.buffer,value.byteOffset,value.byteLength));
      }
      for(let i=0;i<100;i++)mujoco.mj_step(model,data);
      return {geometry:hash.digest('hex'),qpos:Array.from(data.qpos),qvel:Array.from(data.qvel),time:data.time};
    }
    for (const [sceneXml, expectedGeoms, fileBackend] of [
      ['rs_grasp_scene.xml',66,'auto'],['rs_agv_scene.xml',92,'auto'],
      // Includes the coffee machine's visual anchor, body and top.
      ['rs_dual_tabletop_scene.xml',234,'auto'],['rs_dual_tabletop_scene.xml',234,'vfs']
    ]) {
      const { model, data, startup } = await loadRsScene(mujoco, null, { sceneXml,fileBackend });
      try {
        assert.equal(model.ngeom, expectedGeoms);
        assert.equal(startup.fileBackend,fileBackend==='auto'?'memfs':'vfs');
        assert.deepEqual(roots(),before,'Native source files must be removed after compilation');
        if(sceneXml==='rs_dual_tabletop_scene.xml') {
          const actual=snapshot(model,data);
          if(reference)assert.deepEqual(actual,reference,'Bulk loading must preserve geometry and stepped physics exactly');
          else reference=actual;
        }
      }
      finally { data.delete(); model.delete(); }
    }
    const goodFetch=globalThis.fetch;
    globalThis.fetch=async()=>new Response('<mujoco><worldbody><geom type="unknown"/></worldbody></mujoco>');
    try {await assert.rejects(loadRsScene(mujoco),/unknown|invalid/i);}
    finally {globalThis.fetch=goodFetch;}
    assert.deepEqual(roots(),before,'Failed native compilation must also remove its source files');
  } finally { console.warn = warn; }
} finally {
  globalThis.fetch = originalFetch;
}

// Execute the actual worker with an in-memory Cache API.
const entries = new Map();
const cache = {
  async keys() { return [...entries.keys()].map((url) => new Request(url)); },
  async match(request) { return entries.get(typeof request === 'string' ? request : request.url)?.clone(); },
  async put(request, response) { entries.set(typeof request === 'string' ? request : request.url, response); },
  async delete(request) { return entries.delete(typeof request === 'string' ? request : request.url); }
};
const base = 'https://example.test/sim/';
const listeners = {};
const context = vm.createContext({
  URL, Request, Promise,
  self: {
    registration: { scope: base }, location: { origin: 'https://example.test' },
    addEventListener(type, handler) { listeners[type] = handler; }
  },
  caches: { async open() { return cache; } },
  fetch: async () => new Response('fresh')
});
vm.runInContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
const meshA = `${base}models/meshes/a.stl.gzbin?v=hashA`;
const meshB = `${base}models/meshes/b.stl.gzbin?v=hashB`;
entries.set(meshA, new Response('mesh A'));
entries.set(meshB, new Response('mesh B'));
entries.set(`${base}models/scene.xml?v=old`, new Response('old XML'));
const waits = [];
let result;
listeners.fetch({
  request: new Request(`${base}models/scene.xml?v=new`),
  waitUntil(promise) { waits.push(promise); },
  respondWith(promise) { result = promise; }
});
assert.equal(await (await result).text(), 'fresh');
await Promise.all(waits);
assert(entries.has(meshA) && entries.has(meshB), 'XML updates must preserve every unchanged mesh');
assert(!entries.has(`${base}models/scene.xml?v=old`));
assert(entries.has(`${base}models/scene.xml?v=new`));
const buildingUrl = `${base}environments/campus/chinese-building.glb`;
entries.set(`${buildingUrl}?v=old`, new Response('old building'));
waits.length = 0;
listeners.fetch({
  request: new Request(`${buildingUrl}?v=new`),
  waitUntil(promise) { waits.push(promise); },
  respondWith(promise) { result = promise; }
});
assert.equal(await (await result).text(), 'fresh');
await Promise.all(waits);
assert(!entries.has(`${buildingUrl}?v=old`), 'Old campus assets must be pruned');
context.fetch = async () => { throw new Error('offline'); };
listeners.fetch({
  request: new Request(`${buildingUrl}?v=new`),
  waitUntil() {},
  respondWith(promise) { result = promise; }
});
assert.equal(await (await result).text(), 'fresh', 'Embedded campus GLB must remain usable offline');
assert(entries.has(meshA) && entries.has(meshB), 'Campus asset updates must preserve robot meshes');
const compactA=`${base}models/meshes/a.stl.stlp1.gzbin?v=hashA`;
context.fetch=async()=>new Response('fresh');
listeners.fetch({request:new Request(compactA),waitUntil(promise){waits.push(promise);},respondWith(promise){result=promise;}});
assert.equal(await (await result).text(),'fresh');await Promise.all(waits);
assert(entries.has(compactA)&&!entries.has(meshA),'Packed transport replaces only its own older representation');
assert(entries.has(meshB),'Changing transport must preserve unrelated meshes');
console.log('Loading regression checks passed: bounded parallel downloads, WASM fallback/timeout, arm/AGV/dual scenes, exact VFS/MEMFS geometry and physics equivalence, native file cleanup and per-file cache pruning.');

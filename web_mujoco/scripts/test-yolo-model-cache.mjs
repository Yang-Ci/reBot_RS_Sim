import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCachedYoloSession} from '../src/yolo-model-cache.js';

const originalCaches = globalThis.caches, originalFetch = globalThis.fetch;
const entries = new Map(), requests = [];
const cache = {
  async match(url) { return entries.get(url)?.clone(); },
  async put(url, response) { entries.set(url, response.clone()); },
  async delete(url) { return entries.delete(typeof url === 'string' ? url : url.url); },
  async keys() { return [...entries.keys()].map(url => new Request(url)); }
};
const storage = {async open() {return cache;}};
const url = 'https://example.test/sim/yolo/objects.onnx?v=first';
const next = 'https://example.test/sim/yolo/objects.onnx?v=second';
const other = 'https://example.test/other/yolo/objects.onnx?v=keep';
const decode = async bytes => {
  const value = new TextDecoder().decode(bytes);
  if (value === 'corrupt') throw Error('invalid model');
  return value;
};
try {
  globalThis.caches = storage;
  globalThis.fetch = async (key, options = {}) => {
    requests.push({key, options});
    return new Response(key === next ? 'new model' : 'first model');
  };
  const first = await createCachedYoloSession(url, decode);
  assert.equal(first.model, 'first model'); assert.equal(first.metrics.source, 'network');
  assert.equal(first.metrics.bytes, 11); assert(entries.has(url));
  const second = await createCachedYoloSession(url, decode);
  assert.equal(second.model, first.model); assert.equal(second.metrics.source, 'cache');
  assert.equal(requests.length, 1, 'Repeat visits must not request the model again');
  entries.set(other, new Response('other'));
  const updated = await createCachedYoloSession(next, decode);
  assert.equal(updated.model, 'new model'); assert.equal(updated.metrics.source, 'network');
  assert(entries.has(next)); assert(!entries.has(url)); assert(entries.has(other));
  entries.set(next, new Response('corrupt'));
  const recovered = await createCachedYoloSession(next, decode);
  assert.equal(recovered.model, 'new model'); assert.equal(recovered.metrics.cacheFallback, true);
  assert.equal(recovered.metrics.source, 'network');
  assert.equal(requests.at(-1).options.cache, 'reload');
  assert.equal(await entries.get(next).clone().text(), 'new model');
  const digest = createHash('sha256').update('first model').digest('hex').slice(0, 16);
  const verifiedUrl = `https://example.test/verified/objects.onnx?v=${digest}`;
  entries.set(verifiedUrl, new Response('wrong but parseable'));
  const verified = await createCachedYoloSession(verifiedUrl, decode);
  assert.equal(verified.model, 'first model'); assert.equal(verified.metrics.cacheFallback, true);
  assert.equal(await entries.get(verifiedUrl).clone().text(), 'first model');
  const wrongVersion = 'https://example.test/verified/objects.onnx?v=0000000000000000';
  await assert.rejects(createCachedYoloSession(wrongVersion, decode), /does not match/);
  assert(entries.has(verifiedUrl), 'A mismatched network response must not delete a working version');
  const noCache = await createCachedYoloSession(url, decode, {persistent: false});
  assert.equal(noCache.metrics.source, 'network'); assert(!entries.has(url));
  globalThis.caches = {async open() {throw new Error('storage denied');}};
  assert.equal((await createCachedYoloSession(url, decode)).model, 'first model');
  globalThis.caches = {async open() {return {...cache, async put() {throw new Error('quota');}};}};
  assert.equal((await createCachedYoloSession(url, decode)).model, 'first model');
  globalThis.fetch = async () => new Response('oops', {status: 503});
  await assert.rejects(createCachedYoloSession(url, decode), /503/);
  globalThis.fetch = async () => new Response('corrupt');
  await assert.rejects(createCachedYoloSession(url, decode), /invalid model/);
  assert(!entries.has(url), 'Invalid network models must not be saved');
  console.log('YOLO cache passed: first/repeat visits, content version updates, corruption recovery, storage failures and invalid downloads');
} finally {globalThis.caches = originalCaches; globalThis.fetch = originalFetch;}

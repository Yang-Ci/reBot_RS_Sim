const CACHE_NAME = 'rebot-yolo-model-v1';

// Construct the session before saving bytes, so failed downloads or invalid
// models never replace a working cached version. Cache access is optional.
export async function createCachedYoloSession(url, createSession, { persistent = true } = {}) {
  const started = performance.now();
  const metrics = { source: 'network', bytes: 0, readMs: 0, verifyMs: 0, initMs: 0, cacheWriteMs: 0, cacheFallback: false };
  const version = new URL(url, globalThis.location?.href).searchParams.get('v');
  let cache;
  if (persistent && globalThis.caches) {
    try { cache = await caches.open(CACHE_NAME); } catch { /* Cache is unavailable or denied. */ }
  }
  let response;
  if (cache) {
    try { response = await cache.match(url); } catch { /* Continue with network. */ }
  }
  let fromCache = Boolean(response);
  if (fromCache) metrics.source = 'cache';
  async function obtain(reload = false) {
    const began = performance.now();
    const result = reload || !response ? await fetch(url, reload ? {cache: 'reload'} : {}) : response;
    if (!result.ok) throw new Error(`Vision model HTTP ${result.status}`);
    const bytes = new Uint8Array(await result.arrayBuffer());
    metrics.readMs += performance.now() - began;
    metrics.bytes = bytes.byteLength;
    // A content-versioned URL can still receive newer server bytes while an
    // old page remains open across deployment. Do not poison the old key.
    if (/^[a-f0-9]{16}$/.test(version || '') && globalThis.crypto?.subtle) {
      const check = performance.now();
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      metrics.verifyMs += performance.now() - check;
      const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);
      if (actual !== version) throw new Error('Vision model content does not match its version');
    }
    return bytes;
  }
  async function initialize(bytes) {
    const began = performance.now();
    try { return await createSession(bytes); }
    finally { metrics.initMs += performance.now() - began; }
  }
  let bytes, model;
  try {
    bytes = await obtain();
    model = await initialize(bytes);
  } catch (error) {
    if (!fromCache) throw error;
    metrics.cacheFallback = true;
    metrics.source = 'network';
    try { await cache.delete(url); } catch { /* A failed deletion must not block recovery. */ }
    bytes = await obtain(true);
    model = await initialize(bytes);
    fromCache = false;
  }
  if (cache && !fromCache) {
    const began = performance.now();
    try {
      await cache.put(url, new Response(bytes, {headers: {'content-type': 'application/octet-stream'}}));
      const current = new URL(url, globalThis.location?.href);
      const entries = await cache.keys();
      await Promise.all(entries.map(entry => {
        const old = new URL(entry.url);
        if (old.origin === current.origin && old.pathname === current.pathname && old.href !== current.href) return cache.delete(entry);
      }));
    } catch { /* Quota/private browsing must not block inference. */ }
    metrics.cacheWriteMs = performance.now() - began;
  }
  metrics.totalMs = performance.now() - started;
  return { model, metrics };
}

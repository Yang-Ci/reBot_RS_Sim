// Timeout means no new data, not total download duration. Healthy slow links
// may take arbitrarily long, while connection/body stalls have a finite bound.
export function abortable(promise, signal) {
  if (!signal) return Promise.resolve(promise);
  if (signal.aborted) {
    // Observe a promise that may already have started before the abort check.
    Promise.resolve(promise).catch(() => {});
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort);
    });
  });
}

export async function fetchModelResource(url, {
  signal, onProgress, inactivityTimeoutMs = 8000, retries = 1
} = {}) {
  if (!Number.isFinite(inactivityTimeoutMs) || inactivityTimeoutMs <= 0 ||
      !Number.isInteger(retries) || retries < 0 || retries > 3) {
    throw new RangeError('Invalid model download timeout/retries');
  }
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', cancel, { once: true });
    let timer, reader, complete = false;
    const progress = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(
        new DOMException(`Model download stalled: ${url}`, 'TimeoutError')
      ), inactivityTimeoutMs);
    };
    let retryable = true;
    try {
      progress();
      onProgress?.(0, 0);
      const response = await abortable(fetch(url, {
        cache: 'default', signal: controller.signal
      }), controller.signal);
      if (!response.ok) {
        retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        // Release an unsuccessful response before retrying or falling back.
        void response.body?.cancel().catch(() => {});
        throw new Error(`无法读取 ${url}（HTTP ${response.status}）`);
      }
      progress();
      const total = Number(response.headers.get('content-length')) || 0;
      if (!response.body) {
        const bytes = new Uint8Array(await abortable(response.arrayBuffer(), controller.signal));
        onProgress?.(bytes.byteLength, total || bytes.byteLength);
        complete = true;
        return bytes;
      }
      reader = response.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await abortable(reader.read(), controller.signal);
        if (done) break;
        if (value.byteLength) {
          progress();
          chunks.push(value);
          received += value.byteLength;
          onProgress?.(received, total);
        }
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      complete = true;
      onProgress?.(received, total || received);
      return bytes;
    } catch (error) {
      signal?.throwIfAborted();
      if (!retryable || attempt >= retries) throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (reader) {
        if (!complete) void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      controller.abort();
    }
  }
}

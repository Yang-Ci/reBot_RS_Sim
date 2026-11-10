let worker = null;
let nextId = 0;
const pending = new Map();

function stopWorker(reason) {
  worker?.terminate();
  worker = null;
  for (const request of pending.values()) request.reject(reason);
  pending.clear();
}

function request(type, signal, extra = {}, transfer = []) {
  signal.throwIfAborted();
  if (!worker) {
    worker = new Worker(new URL('./yolo-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const request = pending.get(data.id);
      if (!request) return;
      if (data.error) {
        stopWorker(new Error(data.error));
        return;
      }
      pending.delete(data.id);
      request.resolve(data.result);
    };
    worker.onerror = () => stopWorker(new Error('YOLO worker failed'));
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const abort = () => stopWorker(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    const done = fn => value => { signal.removeEventListener('abort', abort); fn(value); };
    pending.set(id, { resolve: done(resolve), reject: done(reject) });
    worker.postMessage({ id, type, ...extra }, transfer);
  });
}

export const initializeYolo = signal => request('init', signal);
export const detectYolo = (pixels, target, signal, minConfidence) =>
  request('detect', signal, { pixels, target, minConfidence }, [pixels.buffer]);

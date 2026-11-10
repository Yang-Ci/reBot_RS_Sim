import * as ort from 'onnxruntime-web/wasm';
import ortModuleUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from '../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url';

const SIZE = 640, CHANNELS = 32, PROTO_SIZE = 160, COUNT = 8400;
const IDS = ['red', 'blue', 'yellow'];
let sessionPromise;
function session() {
  if (!sessionPromise) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = { mjs: ortModuleUrl, wasm: ortWasmUrl };
    sessionPromise = ort.InferenceSession.create(`${import.meta.env.BASE_URL}yolo/objects.onnx`, { executionProviders: ['wasm'] });
  }
  return sessionPromise;
}

function iou(a, b) {
  const width = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const overlap = width * height;
  const area = box => Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
  return overlap / (area(a) + area(b) - overlap);
}

function decodeMask(candidate, predictions, prototypes) {
  const [x1, y1, x2, y2] = candidate.box;
  const left = Math.max(0, Math.floor(x1)), top = Math.max(0, Math.floor(y1));
  const right = Math.min(639, Math.ceil(x2)), bottom = Math.min(479, Math.ceil(y2));
  const width = Math.max(0, right - left + 1), height = Math.max(0, bottom - top + 1);
  const data = new Uint8Array(width * height);
  // Bilinear sampling of mask logits from the 160x160 prototype tensor.
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const px = Math.max(0, Math.min(PROTO_SIZE - 1, (x + .5) / 4 - .5));
    const py = Math.max(0, Math.min(PROTO_SIZE - 1, (y + 80 + .5) / 4 - .5));
    const ax = Math.floor(px), ay = Math.floor(py), bx = Math.min(ax + 1, 159), by = Math.min(ay + 1, 159);
    const fx = px - ax, fy = py - ay;
    let logit = 0;
    for (let c = 0; c < CHANNELS; c++) {
      const offset = c * PROTO_SIZE * PROTO_SIZE;
      const a = prototypes[offset + ay * PROTO_SIZE + ax] * (1 - fx) + prototypes[offset + ay * PROTO_SIZE + bx] * fx;
      const b = prototypes[offset + by * PROTO_SIZE + ax] * (1 - fx) + prototypes[offset + by * PROTO_SIZE + bx] * fx;
      logit += predictions[(7 + c) * COUNT + candidate.index] * (a * (1 - fy) + b * fy);
    }
    if (logit > 0 && x >= x1 && x <= x2 && y >= y1 && y <= y2) data[(y - top) * width + x - left] = 1;
  }
  return { left, top, width, height, data };
}

async function detect(pixels, target, minConfidence) {
  const model = await session();
  const rgb = new Float32Array(3 * SIZE * SIZE);
  rgb.fill(114 / 255);
  for (let y = 0; y < 480; y++) for (let x = 0; x < SIZE; x++) {
    const src = (y * SIZE + x) * 4, dst = (y + 80) * SIZE + x;
    rgb[dst] = pixels[src] / 255;
    rgb[SIZE * SIZE + dst] = pixels[src + 1] / 255;
    rgb[2 * SIZE * SIZE + dst] = pixels[src + 2] / 255;
  }
  const result = await model.run({ [model.inputNames[0]]: new ort.Tensor('float32', rgb, [1, 3, SIZE, SIZE]) });
  const out = result[model.outputNames[0]], proto = result[model.outputNames[1]];
  if (out.dims.join(',') !== '1,39,8400' || proto.dims.join(',') !== '1,32,160,160') throw new Error('Unexpected YOLOE output shape');
  const predictions = out.data, candidates = [];
  const targetIndex = IDS.indexOf(target);
  let highestConfidence = 0;
  for (let i = 0; i < COUNT; i++) {
    if (targetIndex >= 0) highestConfidence = Math.max(highestConfidence, predictions[(4 + targetIndex) * COUNT + i]);
    let cls = 0, confidence = predictions[4 * COUNT + i];
    for (let c = 1; c < 3; c++) if (predictions[(4 + c) * COUNT + i] > confidence) {
      cls = c; confidence = predictions[(4 + c) * COUNT + i];
    }
    if (confidence < .18) continue;
    const x = predictions[i], y = predictions[COUNT + i] - 80;
    const w = predictions[2 * COUNT + i], h = predictions[3 * COUNT + i];
    candidates.push({ index: i, id: IDS[cls], confidence, box: [x - w / 2, y - h / 2, x + w / 2, y + h / 2] });
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const kept = [];
  for (const candidate of candidates) {
    if (!kept.some(other => iou(candidate.box, other.box) > .5)) kept.push(candidate);
  }
  const detections = kept.filter(item => item.id === target && item.confidence >= minConfidence)
    .map(item => ({ id: item.id, confidence: item.confidence, box: item.box,
      mask: decodeMask(item, predictions, proto.data) }));
  return { detections, highestConfidence };
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') await session();
    const result = data.type === 'detect' ? await detect(data.pixels, data.target, data.minConfidence) : undefined;
    self.postMessage({ id: data.id, result });
  } catch (error) { self.postMessage({ id: data.id, error: error?.message || String(error) }); }
};

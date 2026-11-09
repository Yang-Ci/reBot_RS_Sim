import { paintCameraFrame } from './camera-sampler.js';
import { pixelToWorld } from './rgbd-perception.js';
import { detectYolo, initializeYolo } from './yolo-browser-runtime.js';

const FRAME_SIZE = { width: 640, height: 480 };
const TABLE_HEIGHT = 0.10;
const MIN_CONFIDENCE = 0.40;
const SHAPES = {
  red: { length: 0.045, width: 0.045, height: 0.045 },
  blue: { length: 0.052, width: 0.032, height: 0.038 },
  yellow: { length: 0.040, width: 0.040, height: 0.052, round: true }
};

function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x1, y1] = polygon[i];
    const [x2, y2] = polygon[j];
    if ((y1 > y) !== (y2 > y) && x < x1 + (x2 - x1) * (y - y1) / (y2 - y1)) inside = !inside;
  }
  return inside;
}

function fitRectangle(points) {
  let best;
  // Box edges have 90° symmetry. Match the longer side after fitting.
  for (let degrees = 0; degrees < 90; degrees++) {
    const yaw = degrees * Math.PI / 180;
    const cosine = Math.cos(yaw), sine = Math.sin(yaw);
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const [x, y] of points) {
      const u = x * cosine + y * sine, v = -x * sine + y * cosine;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const alongU = maxU - minU, alongV = maxV - minV;
    const area = alongU * alongV;
    if (best && area >= best.area) continue;
    const u = (minU + maxU) / 2, v = (minV + maxV) / 2;
    best = { area, x: u * cosine - v * sine, y: u * sine + v * cosine,
      yaw: alongU >= alongV ? yaw : yaw + Math.PI / 2,
      length: Math.max(alongU, alongV), width: Math.min(alongU, alongV) };
  }
  return best;
}

function measuredPose(frame, detection) {
  const shape = SHAPES[detection.id];
  const { box, polygon, mask } = detection;
  if (!shape || !Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite) ||
      (!mask && (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 2048 ||
      !polygon.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))))) return null;
  const [x1, y1, x2, y2] = box;
  if (x2 <= x1 || y2 <= y1 || x2 - x1 > 160 || y2 - y1 > 160) return null;

  const points = [];
  const expectedTop = TABLE_HEIGHT + shape.height;
  for (let y = Math.max(0, Math.floor(y1)); y <= Math.min(frame.height - 1, Math.ceil(y2)); y++) {
    for (let x = Math.max(0, Math.floor(x1)); x <= Math.min(frame.width - 1, Math.ceil(x2)); x++) {
      const inMask = mask ? x >= mask.left && x < mask.left + mask.width && y >= mask.top && y < mask.top + mask.height &&
        mask.data[(y - mask.top) * mask.width + x - mask.left] : insidePolygon(x, y, polygon);
      if (!inMask) continue;
      const point = pixelToWorld(frame, x, frame.height - 1 - y);
      if (point && Math.abs(point[2] - expectedTop) < 0.005) points.push(point);
    }
  }
  if (points.length < 35) return null;
  const fit = fitRectangle(points);
  if (fit.length < shape.length * 0.74 || fit.length > shape.length * 1.15 ||
      fit.width < shape.width * 0.74 || fit.width > shape.width * 1.15 ||
      fit.x < 0.14 || fit.x > 0.60 || Math.abs(fit.y) > 0.42 || Math.hypot(fit.x, fit.y) > 0.54) return null;

  // Reject fragmented or mostly hidden tops. The overhead camera looks down
  // along world Z, so pixel area scales by depth² / (fx * fy).
  const depths = points.map(point => point[2]).sort((a, b) => a - b);
  const top = depths[Math.floor(depths.length / 2)];
  const distance = frame.camera.matrixWorld[14] - top;
  const area = points.length * distance * distance / (frame.camera.fx * frame.camera.fy);
  const expectedArea = shape.width * shape.length * (shape.round ? Math.PI / 4 : 1);
  if (area < expectedArea * 0.62 || area > expectedArea * 1.16) return null;
  return { source: 'yolo-rgbd', position: { x: fit.x, y: fit.y, z: top - shape.height / 2 },
    yaw: shape.round ? 0 : fit.yaw, confidence: detection.confidence };
}

export async function observeYoloGrasp(view, id, signal, preview) {
  await initializeYolo(signal);
  const capturedAtMs = performance.now();
  const frame = await view.captureCamera('overhead', { ...FRAME_SIZE, asyncReadback: true });
  signal.throwIfAborted();
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  paintCameraFrame(canvas.getContext('2d'), frame);
  const pixels = canvas.getContext('2d').getImageData(0, 0, frame.width, frame.height).data;
  const detections = await detectYolo(pixels, id, signal);
  signal.throwIfAborted();
  const candidates = detections.filter(item => item.id === id && Number.isFinite(item.confidence) && item.confidence >= MIN_CONFIDENCE)
    .map(item => ({ detection: item, pose: measuredPose(frame, item) })).filter(item => item.pose);
  const selected = candidates.length === 1 ? candidates[0] : null;

  if (preview) {
    preview.width = frame.width;
    preview.height = frame.height;
    const context = preview.getContext('2d');
    context.drawImage(canvas, 0, 0);
    if (selected) {
      const [x1, y1, x2, y2] = selected.detection.box;
      context.strokeStyle = '#7deac2';
      context.lineWidth = 3;
      context.strokeRect(x1, y1, x2 - x1, y2 - y1);
    }
    preview.hidden = false;
  }
  return selected ? { ...selected.pose, timestamp: frame.timestamp, capturedAtMs } : null;
}

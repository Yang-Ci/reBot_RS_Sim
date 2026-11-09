"""Loopback-only YOLOE inference for the optional Web MuJoCo grasp demo."""

import argparse
import io
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--weights', type=Path, required=True, help='Local YOLOE segmentation checkpoint')
    fixture = Path(__file__).resolve().with_name('yolo-grasp-reference')
    parser.add_argument('--reference', type=Path, default=fixture.with_suffix('.png'),
                        help='RGB image used for visual prompts')
    parser.add_argument('--prompts', type=Path, default=fixture.with_suffix('.json'),
                        help='JSON with red/blue/yellow pixel boxes [x1,y1,x2,y2]')
    args = parser.parse_args()
    for path in (args.weights, args.reference, args.prompts):
        if not path.is_file():
            parser.error(f'File not found: {path}')

    os.environ.setdefault('YOLO_CONFIG_DIR', str(Path(__file__).resolve().parents[1] / '.reports/yolo-grasp'))
    os.environ.setdefault('YOLO_OFFLINE', 'true')
    import numpy as np
    import torch
    from PIL import Image
    from ultralytics import YOLOE
    from ultralytics.models.yolo.yoloe.predict import YOLOEVPSegPredictor

    classes = ('red', 'blue', 'yellow')
    prompts = json.loads(args.prompts.read_text(encoding='utf-8'))
    boxes = np.asarray([prompts[name] for name in classes], dtype=np.float32)
    with Image.open(args.reference) as reference:
        width, height = reference.size
    if (boxes.shape != (3, 4) or not np.isfinite(boxes).all() or (boxes[:, :2] < 0).any()
            or (boxes[:, 2:] > [width, height]).any() or (boxes[:, :2] >= boxes[:, 2:]).any()):
        parser.error('Each visual prompt must be a nonempty box inside the reference image')

    torch.set_num_threads(4)
    model = YOLOE(str(args.weights.resolve()))
    options = dict(device='cpu', imgsz=640, conf=.18, iou=.5, agnostic_nms=True, retina_masks=True, verbose=False)
    warmup = model.predict(str(args.reference), refer_image=str(args.reference), predictor=YOLOEVPSegPredictor,
                           visual_prompts={'bboxes': boxes, 'cls': np.arange(len(classes))}, **options)[0]
    if warmup.masks is None:
        raise RuntimeError('YOLOE did not segment the reference image. Check the checkpoint and visual prompts.')
    inference_lock = Lock()

    class Handler(BaseHTTPRequestHandler):
        def reply(self, status, payload):
            body = json.dumps(payload).encode('utf-8')
            try:
                self.send_response(status)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path == '/api/yolo/health':
                self.reply(200, {'ready': True})
            else:
                self.reply(404, {'error': 'not-found'})

        def do_POST(self):
            if self.path != '/api/yolo/detect':
                self.reply(404, {'error': 'not-found'})
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                size = 0
            if not 0 < size <= 1024 * 1024 or self.headers.get_content_type() != 'image/png':
                self.reply(400, {'error': 'invalid-image'})
                return
            self.connection.settimeout(8)
            try:
                with Image.open(io.BytesIO(self.rfile.read(size))) as image:
                    if image.format != 'PNG' or image.size != (640, 480):
                        raise ValueError('Expected a 640x480 PNG frame')
                    rgb = np.asarray(image.convert('RGB'))
            except (OSError, ValueError, Image.DecompressionBombError):
                self.reply(400, {'error': 'invalid-image'})
                return
            if not inference_lock.acquire(blocking=False):
                self.reply(503, {'error': 'busy'})
                return
            try:
                result = model.predict(np.ascontiguousarray(rgb[:, :, ::-1]), **options)[0]
                detections = []
                if result.masks is not None:
                    for box, polygon in zip(result.boxes, result.masks.xy):
                        if len(polygon) < 3:
                            continue
                        detections.append({'id': classes[int(box.cls.item())], 'confidence': box.conf.item(),
                                           'box': box.xyxy[0].tolist(), 'polygon': polygon.tolist()})
                self.reply(200, {'detections': detections})
            except Exception as error:
                print(f'YOLOE inference failed: {error}', flush=True)
                self.reply(500, {'error': 'inference-failed'})
            finally:
                inference_lock.release()

    with ThreadingHTTPServer(('127.0.0.1', 8766), Handler) as server:
        print('YOLOE ready at http://127.0.0.1:8766', flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()

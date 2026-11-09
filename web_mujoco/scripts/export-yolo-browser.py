"""Export the prompted YOLOE segmentation model used by the browser demo."""
import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

os.environ.setdefault('YOLO_OFFLINE', 'true')
os.environ.setdefault('YOLO_AUTOINSTALL', 'False')

import numpy as np
import torch
from ultralytics import YOLOE
from ultralytics.models.yolo.yoloe.predict import YOLOEVPSegPredictor

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--weights', type=Path, required=True)
parser.add_argument('--output', type=Path, default=root / 'public/yolo/objects.onnx')
args = parser.parse_args()
reference = root / 'scripts/yolo-grasp-reference.png'
prompts = json.loads((root / 'scripts/yolo-grasp-reference.json').read_text(encoding='utf-8'))
classes = ('red', 'blue', 'yellow')
torch.set_num_threads(4)
with tempfile.TemporaryDirectory(prefix='yolo-browser-export-') as directory:
    weights = Path(directory) / 'yoloe-11s-seg.pt'
    shutil.copy2(args.weights, weights)
    model = YOLOE(str(weights))
    model.predict(str(reference), refer_image=str(reference), predictor=YOLOEVPSegPredictor,
                  visual_prompts={'bboxes': np.array([prompts[name] for name in classes], dtype=np.float32),
                                  'cls': np.arange(len(classes))},
                  device='cpu', imgsz=640, conf=.18, verbose=False)
    output = Path(model.export(format='onnx', imgsz=640, opset=17, simplify=False, device='cpu'))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(output, args.output)
    print(f'Exported prompted browser model to {args.output}')

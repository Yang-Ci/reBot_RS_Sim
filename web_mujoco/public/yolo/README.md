# Browser YOLOE model

`objects.onnx` is a YOLOE-11s segmentation model with visual prompts for the
red, blue and yellow objects baked in from `scripts/yolo-grasp-reference.png`
and `scripts/yolo-grasp-reference.json`. The source checkpoint is
[`yoloe-11s-seg.pt`](https://github.com/ultralytics/assets/releases/download/v8.3.0/yoloe-11s-seg.pt)
(SHA-256 `8e439445c87338b79d9ce21dec109f4621e26df67e94d26ea1a98c1e64dce3e3`).
It was exported with Ultralytics 8.4.35, PyTorch 2.6.0 and ONNX 1.17.0 using
`scripts/export-yolo-browser.py`. The exported model SHA-256 is
`d171223b05174f4171ce9f734925987e5227fbdc86bbd30c6a7234884afbfe4e`.

Ultralytics distributes its trained models under AGPL-3.0 or an Enterprise
license. See [Ultralytics licensing](https://www.ultralytics.com/license) before
distributing this model as part of a website.

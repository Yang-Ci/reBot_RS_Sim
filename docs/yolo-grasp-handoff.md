# 标准机械臂 YOLO 视觉抓取交接

更新日期：2026-11-09

## 当前实现

标准款网页可以用「YOLO 视觉抓取」收纳选中的红方块、蓝长方块或黄色圆柱。YOLOE 模型、ONNX Runtime Web 和 RGB-D 位姿估计都在浏览器运行，不需要 Python 推理服务。标准款的开发和生产网页均提供该按钮；首次使用时按需加载约 39 MB 的模型和 WebAssembly 运行时。

浏览器从固定俯视相机采集 640×480 的 RGB-D 图像。模型对 RGB 图像输出类别、置信度和分割掩码；网页用同一帧的深度和标定反投影掩码内的像素，检查桌面上方的顶面尺寸，并估计抓取中心与水平朝向。平面收纳框会被深度检查拒绝。模型使用参考图中三个物块的视觉提示，提示已固化到导出的模型，无法在运行时更换；更换提示需要重新导出。

机械臂先移动到目标前方的观察位置，减少俯视相机遮挡，再采集带仿真时间戳的新帧。水平位移不超过 25 mm、高度变化不超过 6 mm、按物块对称性折算的朝向变化不超过 20° 时，用新位姿修正接近位置并规划下探。观测不可用、遮挡、位移或朝向超限，或者帧超过 4 秒时停止；复核推理最多等待 12 秒。最后 25 mm 保持姿态直线下探，双指接触后抬升。搬运和放置仍使用仿真接触与物块状态反馈。第二次观察后没有持续视觉跟踪，当前适用于固定俯视相机下正放的三个已知物块。

| 入口 | 职责 |
| --- | --- |
| [`web_mujoco/public/yolo/objects.onnx`](../web_mujoco/public/yolo/objects.onnx) | 固化三类视觉提示的 YOLOE 分割模型 |
| [`web_mujoco/src/yolo-worker.js`](../web_mujoco/src/yolo-worker.js) | 浏览器工作线程内的模型推理、非极大值抑制和分割掩码 |
| [`web_mujoco/src/yolo-grasp.js`](../web_mujoco/src/yolo-grasp.js) | 相机采集、深度反投影及位姿筛选 |
| [`web_mujoco/src/grasp-demo.js`](../web_mujoco/src/grasp-demo.js) | 重新观察、抓取、搬运和支撑检查 |
| [`web_mujoco/src/grasp-descent.js`](../web_mujoco/src/grasp-descent.js) | 腕部姿态和近桌轨迹 |

## 运行与验证

在 `web_mujoco/` 执行 `npm ci` 和 `npm run dev`，打开 `http://127.0.0.1:5173/?variant=arm`，选择目标物块并点击「YOLO 视觉抓取」。首次加载模型可能较慢；后续观测复用浏览器中的模型。`npm run build` 会把模型和运行时打入静态网页，生产部署需确保模型文件随构建产物发布。

`npm run test:yolo-browser` 在启动的 Vite 页面中实际运行浏览器 YOLOE，用场景截图和合成的已知深度检查三个位姿，并检查平面标记被拒绝；这不是完整的物理抓取测试。`npm run test:yolo-reobservation` 用注入观测的 MuJoCo 回归测试小幅位移、超限位移、遮挡、取消和帧时效。`npm run test:yolo-grasp` 在启动的 Vite 页面中运行三色完整浏览器抓取。标准款与 AGV 物理回归分别使用 `npm run smoke` 和 `npm run test:variants`。

本轮在关闭 Python 推理服务后，已在开发页面实际完成默认位置红、黄、蓝三色的浏览器 YOLOE 抓取和收纳；生产构建通过并包含模型文件。上述结果不代表扰动或生产部署均已验收。

## 模型来源与导出

源权重、固定提示、导出环境、校验值及许可信息见 [`public/yolo/README.md`](../web_mujoco/public/yolo/README.md)。需要更换提示时，准备对应的权重、参考图和标注，在具备 Ultralytics 8.4.35、PyTorch 和 ONNX 的环境执行：

```bash
python scripts/export-yolo-browser.py --weights /path/to/yoloe-11s-seg.pt
```

该脚本仅用于构建模型，网页运行不需要 Python。Ultralytics 模型采用 AGPL-3.0 或商业许可，发布前应核对适用的许可条件。

## 后续优先级

1. **放置后视觉复核。** 释放后让机械臂退开视线，在物块静止时重新观测收纳区，用分割与深度区分物块和地面标记，并记录是否落在目标区。用这一步替代目前对物块仿真状态的放置确认。
2. **建立扰动回归。** 按位置、角度、照明、遮挡和可见面积划分测试集，分别记录位姿误差、抓取成功率、误抓率和正确拒绝率。当前时效和位移阈值是工程值，需用这些样本验证。
3. **扩展到真机。** 接入实机 RGB-D 后重新标定相机内参、相机到机械臂基座的变换和深度比例，复测上述指标，再进入实机抓取验证。

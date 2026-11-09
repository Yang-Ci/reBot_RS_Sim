# 标准机械臂 YOLO 视觉抓取交接

更新日期 2026-11-09

## 当前实现

标准款可在本地开发页面通过「YOLO 视觉抓取」收纳选中的红方块、蓝长方块或黄色圆柱。浏览器抓取一张 640×480 的俯视 RGB-D 图像，只把 RGB 图像送到本机 YOLOE 服务。YOLOE 返回类别、置信度和分割轮廓。浏览器用同一帧的深度和标定将轮廓内的像素反投影，检验桌面上方的顶面尺寸，再估计抓取中心和水平朝向。收纳框在桌面附近，无法通过顶面高度检查。

抓取位置和朝向来自这次观测。现有逆运动学负责生成末端姿态，最后 25 mm 保持姿态直线下探，双指接触后抬升。后续搬运和放置仍使用仿真接触与物块状态反馈。当前实现只在开始时观察一次，适用于固定俯视相机下正放、静止的三个已知物块。

| 入口 | 职责 |
| --- | --- |
| [`web_mujoco/scripts/yolo_grasp_server.py`](../web_mujoco/scripts/yolo_grasp_server.py) | 加载本地 YOLOE 权重和参考框，在 `127.0.0.1:8766` 提供推理 |
| [`web_mujoco/src/yolo-grasp.js`](../web_mujoco/src/yolo-grasp.js) | 拍摄、请求分割、深度反投影、尺寸和位置筛选 |
| [`web_mujoco/src/grasp-demo.js`](../web_mujoco/src/grasp-demo.js) | 接收视觉位姿，执行抓取、搬运和支撑检查 |
| [`web_mujoco/src/grasp-descent.js`](../web_mujoco/src/grasp-descent.js) | 计算抓取及放置的腕部姿态和近桌轨迹 |

## 本地复现

在 `web_mujoco/` 安装前端依赖并启动 Vite。Python 推理侧已在 Python 3.9、Ultralytics 8.3.227 和 CPU PyTorch 2.8 上验证。权重约 28 MB，按下列命令单独下载。参考图和标注随仓库提供。

```powershell
cd web_mujoco
New-Item -ItemType Directory -Force .reports/yolo-grasp | Out-Null
curl.exe -fL https://github.com/ultralytics/assets/releases/download/v8.3.0/yoloe-11s-seg.pt -o .reports/yolo-grasp/yoloe-11s-seg.pt
python -m pip install ultralytics==8.3.227
python scripts/yolo_grasp_server.py --weights .reports/yolo-grasp/yoloe-11s-seg.pt
```

在另一个终端运行 `npm ci` 和 `npm run dev`，打开 `http://127.0.0.1:5173/?variant=arm&vision=yolo`。选中目标物块并点击「YOLO 视觉抓取」。成功识别后会显示检测框、置信度和估计的抓取位置。更换相机或参考图时，用 `--reference` 和 `--prompts` 指定配套的图像与像素框。模型和运行报告保存在 `.reports/`。

可以在两个服务都运行时执行 `npm run test:yolo-grasp`。如果 Vite 使用其他端口，可追加 `-- --url=http://127.0.0.1:5174/`。标准款与 AGV 物理回归分别使用 `npm run smoke` 和 `npm run test:variants`。YOLO 入口仅在本地开发模式显式打开，线上静态演示继续使用原有入口。

## 本轮验收

| 场景 | 浏览器实测 |
| --- | --- |
| 蓝块前移 30 mm、左移 15 mm | YOLOE 置信度 87%，估计 X 369 mm、Y 76 mm，完成收纳 |
| 默认位置红块 | 置信度 73%，估计 X 240 mm、Y −299 mm，完成收纳 |
| 默认位置黄色圆柱 | 置信度 41%，估计 X 329 mm、Y −199 mm，完成收纳。置信度接近 40% 的门槛 |
| 注入 99% 置信度的平面收纳框检测 | 被深度检查拒绝，抓取未启动 |

标准款收纳与叠放、AGV 停靠抓取与叠放、复位测试和 GitHub Pages 生产构建也已通过。三色结果来自当前场景和参考图，下一轮需用扰动测试覆盖更广的摆放与遮挡条件。

## 下一轮优先级

1. **抓取前重新观察。** 接近到高位后再取一张有时间戳的 RGB-D 帧。目标有小幅位移时重规划一次，持续遮挡、位移超限或姿态不确定时停止。验收时在首次观察后移动方块，分别验证可修正与必须拒绝的情形。
2. **放置后视觉复核。** 释放后让机械臂退开视线，在物块静止时重新观测收纳区。用分割与深度区分物块和地面标记，并记录是否落在目标区。用这一步替代目前对物块仿真状态的放置确认。
3. **建立扰动回归。** 按位置、角度、照明、遮挡和可见面积划分测试集，分别记录位姿误差、抓取成功率、误抓率和正确拒绝率。仿真真值可用于标注和评分。若参考框提示仍容易把收纳框当作目标，再用这些样本微调三类分割模型。
4. **再扩展到真机。** 接入实机 RGB-D 后重新标定相机内参、相机到机械臂基座的变换和深度比例，复测上述指标，再进入实机抓取验证。

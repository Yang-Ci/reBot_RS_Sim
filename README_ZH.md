# reBot RS Sim

[English](README.md) | **简体中文**

B601-RS 机械臂与四轮 AGV 的仿真项目，提供浏览器 MuJoCo 演示、ROS 2 MuJoCo 仿真、Gazebo 实验室以及 SLAM / Nav2 导航。仓库同时保留 RS 机械描述资源和 AGV v1 底盘 CAD。

想直接体验机械臂抓取和移动底盘，先运行 Web 版本；需要 ROS 话题、建图或导航时，再使用 ROS 2 工作区。

## 🚀 在线体验仿真

直接在浏览器中体验 reBot Arm B601-RS MuJoCo 数字孪生，无需安装。你可以切换标准机械臂与 AGV 配置，控制关节和 TCP，查看全局俯视与 D405 腕部相机，并运行自动收纳和堆叠演示。首次下载模型可能需要一些时间，推荐使用 Chrome 或 Edge。

[**▶ 启动 reBot Arm 交互演示**](https://seeed-projects.github.io/reBot_RS_Sim/)

## 功能

- **机械臂**：六轴关节和夹爪控制、TCP 拖拽、物体抓取、颜色收纳和堆叠演示。
- **移动底盘**：四轮底盘模型、键盘驾驶、网页选点避障导航、抓取工位停靠。
- **观察与展示**：全局俯视 / D405 腕部相机、零件选择与隔离、分阶段爆炸视图、多语言界面。
- **ROS 2**：MuJoCo 关节同步、仿真驱动、IK / 轨迹接口、相机与目标状态发布。
- **实验室导航**：MuJoCo 和 Gazebo 两种后端，共用实验室地图及 SLAM Toolbox / Nav2 配置。

网页导航使用独立的网格 A*；ROS 导航使用 Nav2。网页可单独运行，不需要 ROS 或真机连接。ROS 目标检测节点使用仿真物体状态生成检测结果。

## Web 快速启动

推荐使用 Node.js 22（与仓库 CI 一致），以及 Chrome 或 Edge。在仓库根目录执行：

```bash
cd web_mujoco
npm ci
npm run dev
```

打开终端显示的地址，默认是 [http://127.0.0.1:5173](http://127.0.0.1:5173)。

| 配置 | 入口 | 场景 |
| --- | --- | --- |
| 标准机械臂（默认） | `/?variant=arm` | `rs_grasp_scene.xml`，包含工作台和抓取物体 |
| 双臂家居桌面 | `/?variant=dual` | `rs_dual_tabletop_scene.xml`，双 reBot、木桌、托盘、收纳篮和物品整理 |
| AGV 底盘款 | `/?variant=agv` | `rs_agv_scene.xml`，包含移动底盘和实验室 |
| AGV 园区街区 | `/?variant=agv-campus` | `rs_agv_campus_scene.xml`，包含三栋居民楼、十字路口和服务区域 |

页面顶部可以切换配置。AGV 款支持 WASD / 方向键驾驶、空格停车、地面选点导航和“前往抓取区”；停靠后可执行抓取任务。首次加载需要下载场景网格。

双臂家居场景可一键把鸡蛋、线轴整理到托盘，把苹果、青柠整理到收纳篮，也可单件整理。
新增杯勺协作：左臂拿稳杯子，右臂夹勺柄、对准杯口送入，随后松勺并将杯子放回桌面。
默认杯勺协作和“会合展示后分别归位”使用 RGB-D 视觉闭环、完整位姿 IK 和纯接触夹持，全程关闭抓取 weld 约束；分类整理也使用夹爪接触。
房间补充餐边柜、层架、窗帘、座椅和厨房小物，
杯子、杯耳、金属餐勺与水果增加细节。下方任务卡片可折叠，另有房间全景与协作特写。
支持暂停、复位、速度和相机视角切换，使用 MuJoCo 接触物理抓取。该场景执行预设任务，尚未接入自然语言控制。

“接咖啡、搅拌与送勺喂食（演示）”由左臂接取并持稳咖啡杯，右臂搅拌后将餐勺送到坐姿人物嘴边。
该任务使用可释放的辅助夹持约束，界面标注“辅助夹持演示”；咖啡采用可视化液体模型，尚未求解流体动力学。

园区模式新增充电 / 配送区导航快捷入口和跟随相机，目前用于导航停靠演示，不模拟电池充电或物流任务。详细街景在网页中显示，原生 MuJoCo 使用简化建筑轮廓，尚未配置 ROS / Nav2 园区地图。

构建与本地预览：

```bash
npm run build
npm run preview
```

GitHub Pages 发布流程见 [`.github/workflows/pages.yml`](.github/workflows/pages.yml)：在仓库 Settings → Pages 中选择 GitHub Actions，推送 `main` 或手动触发 workflow。构建会按当前仓库名设置部署子路径。

更多交互和加载机制见 [Web 文档](web_mujoco/README.md)。

## 目录与依赖

```text
reBot_RS_Sim/
├── web_mujoco/              # 浏览器界面、MuJoCo WASM、网页导航与抓取
├── rebotarm_mujoco_rs/      # ROS 2 MuJoCo 节点及运行模型（XML / STL）
├── rebotarm_gazebo/         # Gazebo 场景、两种后端的 SLAM / Nav2 启动配置
├── rebotarm_msgs/           # ROS 2 消息、服务和 action
├── RS/                     # RS 独立 URDF / STL；Gazebo 模型再生成的输入
├── mobile_base/
│   ├── cad/agv_v1/          # 底盘参数化脚本、STEP / STL 和校验资料
│   └── docs/               # 轮子方案调研
├── tools/                  # RS + AGV MuJoCo 场景生成脚本
└── docs/                   # 机械描述说明
```

当前主要读取关系：

```text
Web ────────────────────────────┐
ROS 2 MuJoCo ──────────────────┼─> rebotarm_mujoco_rs/models/
Gazebo 已生成的机器人 SDF ──────┘   （Gazebo 读取其中的网格）

RS/urdf/ReBot_Arm_RS.urdf ─────────> Gazebo SDF 生成脚本
mobile_base/cad/agv_v1/stl/ ───────> MuJoCo AGV 场景生成脚本
```

**RS 与 DM 共用的 10 个夹爪精细碰撞 STL，统一保留在 `rebotarm_mujoco_rs/models/meshes/`。** 根目录 DM 描述包及 RS 描述目录中的精细碰撞副本已清理。RS URDF 仍保留自身外观与整件碰撞网格；MuJoCo 使用运行目录中的精细碰撞件。

## ROS 2 仿真

### 环境与构建

以 ROS 2 Jazzy 环境为例，准备 `colcon`、`rosdep`；Gazebo 后端使用 Harmonic。依赖包含 Nav2、SLAM Toolbox、RViz 和 `ros_gz`，由各包的 `package.xml` 声明。

MuJoCo 后端还需要 Python `mujoco`；它未在当前 `package.xml` 中声明，需要单独准备。确认执行 ROS 节点的 Python 能导入 `mujoco`、`numpy` 和 `scipy`；关节滑块窗口还需要 `tkinter`。

从仓库根目录构建（`rosdep` 须已初始化）：

```bash
source /opt/ros/jazzy/setup.bash
rosdep install --from-paths rebotarm_msgs rebotarm_mujoco_rs rebotarm_gazebo --ignore-src -r -y
colcon build --symlink-install --packages-select \
  rebotarm_msgs rebotarm_mujoco_rs rebotarm_gazebo
source install/setup.bash
```

仓库已提交运行所需 XML / STL，首次启动无需重新生成模型。每个新终端均需加载 ROS 和工作区环境。

### 选择流程

每次选择一个仿真后端和一个流程运行：

| 流程 | MuJoCo | Gazebo |
| --- | --- | --- |
| 实验室与机器人 | `mujoco_lab.launch.py` | `lab_world.launch.py` |
| 在线建图 | `mujoco_slam.launch.py` | `lab_slam.launch.py` |
| 边建图边导航 | `mujoco_slam_nav.launch.py` | `lab_slam_nav.launch.py` |
| 已有地图定位与导航 | `mujoco_navigation.launch.py` | `lab_navigation.launch.py` |

以上启动文件均属于 `rebotarm_gazebo` 包，例如：

```bash
ros2 launch rebotarm_gazebo mujoco_slam_nav.launch.py
```

无界面运行：MuJoCo 导航命令加 `use_viewer:=false use_rviz:=false`；Gazebo 导航命令加 `gui:=false use_rviz:=false`。默认导航地图是 `rebotarm_gazebo/maps/rebotarm_lab.yaml`。

需要机械臂驱动、相机和任务接口时，使用核心启动入口：

```bash
ros2 launch rebotarm_mujoco_rs mujoco_rs.launch.py \
  simulation_mode:=physics use_viewer:=true
```

核心入口默认开启仿真驱动和任务工具；`mujoco_lab.launch.py` 默认关闭这些工具，侧重底盘导航。关节滑块可在另一终端启动：

```bash
ros2 launch rebotarm_mujoco_rs joint_slider_gui.launch.py
```

主要导航话题是 `/cmd_vel`、`/clock`、`/odom`、`/scan` 和 `/imu`。MuJoCo 发布的导航 TF 为 `odom → base_footprint → base_link → laser / imu_link`，`map → odom` 由 SLAM Toolbox 或 AMCL 发布。机械臂与任务话题默认位于 `/rebotarm_rs/` 命名空间。

详细接口和参数见 [MuJoCo 包文档](rebotarm_mujoco_rs/README.md) 与 [实验室 / 导航文档](rebotarm_gazebo/README.md)。

## 模型与 CAD 维护

| 资源 | 用途 |
| --- | --- |
| [`rs_arm.xml`](rebotarm_mujoco_rs/models/rs_arm.xml) | RS 机械臂、夹爪、腕部相机和碰撞模型 |
| [`rs_grasp_scene.xml`](rebotarm_mujoco_rs/models/rs_grasp_scene.xml) | 引入 `rs_arm.xml`，增加抓取工位 |
| [`rs_agv_scene.xml`](rebotarm_mujoco_rs/models/rs_agv_scene.xml) | 生成后的完整 RS + AGV 实验室场景 |
| [`RS/urdf/ReBot_Arm_RS.urdf`](RS/urdf/ReBot_Arm_RS.urdf) | 独立机械描述，以及 Gazebo SDF 再生成输入 |
| [`mobile_base/cad/agv_v1/`](mobile_base/cad/agv_v1/README_ZH.md) | 底盘 STEP / STL、装配参考与尺寸记录 |

修改基础 MuJoCo 场景或底盘 STL 后，从根目录重新生成 AGV 场景：

```bash
python3 tools/build_rs_agv_model.py
```

脚本读取 `rs_arm.xml`、`rs_grasp_scene.xml`，将六种底盘 STL 复制到运行目录，并生成 `rs_agv_scene.xml`。需要长期保留的场景调整应写入输入或生成脚本。

修改 RS URDF 或静态实验室布局时，按需更新 Gazebo 模型和地图：

```bash
python3 rebotarm_gazebo/scripts/generate_rs_agv_sdf.py
python3 rebotarm_gazebo/scripts/generate_lab_map.py
```

CAD 再生成需要 CadQuery。当前 CAD 脚本的默认底座路径仍是旧工程路径，需显式指定本仓库文件：

```bash
python3 mobile_base/cad/agv_v1/generate_agv_v1.py \
  --repository-base rebotarm_mujoco_rs/models/meshes/base_link.STL
```

URDF / 机械臂网格使用米；底盘 CAD 和腕部支架网格使用毫米，MJCF 已设置相应缩放。保留 URDF 与 `meshes/` 的相对层级及文件名大小写。轮子和紧固件中的 `placeholder` 是装配检查占位模型。

## 检查

Web 检查在 `web_mujoco/` 执行，无需启动 ROS：

```bash
npm run smoke
npm run test:loading
npm run test:reset
npm run test:dual
npm run test:cooperation
npm run test:coffee
npm run test:camera
npm run test:variants
npm run test:campus
npm run test:explode
```

ROS 2 模型和桥接测试在加载工作区环境后执行：

```bash
colcon test --packages-select rebotarm_mujoco_rs
colcon test-result --verbose
```

## 模型来源

RS MuJoCo 模型来源及使用边界见 [MuJoCo 包说明](rebotarm_mujoco_rs/README.md)；D405 腕部支架的来源、版本和许可证见 [第三方模型说明](rebotarm_mujoco_rs/models/THIRD_PARTY_MODELS.md)。机械描述的分类与维护约定见 [机械描述说明](docs/arm_description.md)。

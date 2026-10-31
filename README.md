# reBot RS Sim

**English** | [简体中文](README_ZH.md)

A simulation project for the reBot Arm B601-RS and an optional four-wheel AGV base. It includes a browser-based MuJoCo demo, ROS 2 MuJoCo simulation, a Gazebo laboratory, and SLAM / Nav2 navigation, together with standalone RS robot descriptions and AGV v1 chassis CAD resources.

Start with the web demo to explore manipulation and mobile-base control. Use the ROS 2 workspace for ROS topics, mapping, and navigation.

## 🚀 Try the Online Simulation

Experience the reBot Arm B601-RS MuJoCo digital twin directly in your browser — no installation required. Switch between the standard arm and AGV configurations, control joints and TCP, view the overhead and D405 wrist cameras, and run the automated put-away and stacking demos. The initial model download may take a moment; Chrome or Edge is recommended.

[**▶ Launch the reBot Arm Interactive Demo**](https://seeed-projects.github.io/reBot_RS_Sim/)

## Features

- **Robot arm**: six-axis joint and gripper control, TCP dragging, object grasping, color sorting, and stacking demos.
- **Mobile base**: four-wheel chassis, keyboard driving, point-and-click obstacle-avoiding navigation, and docking at the grasping station.
- **Visualization**: overhead and D405 wrist cameras, part selection and isolation, staged exploded views, and a multilingual interface.
- **ROS 2**: MuJoCo joint synchronization, simulation driver, IK / trajectory interfaces, and camera and object-state publishing.
- **Laboratory navigation**: MuJoCo and Gazebo backends sharing the laboratory map and SLAM Toolbox / Nav2 configuration.

Web navigation uses its own grid-based A* planner; ROS navigation uses Nav2. The web demo runs independently without ROS or a physical robot. The ROS object-detection node generates detections from simulated object states.

## Web Quick Start

Node.js 22 (matching CI) and Chrome or Edge are recommended. From the repository root:

```bash
cd web_mujoco
npm ci
npm run dev
```

Open the URL printed in the terminal, usually [http://127.0.0.1:5173](http://127.0.0.1:5173).

| Configuration | Entry point | Scene |
| --- | --- | --- |
| Standard arm (default) | `/?variant=arm` | `rs_grasp_scene.xml`, including the workbench and graspable objects |
| Dual-arm home tabletop | `/?variant=dual` | `rs_dual_tabletop_scene.xml`, with two reBots, a wooden table, a tray, a basket and four sortable objects |
| AGV base | `/?variant=agv` | `rs_agv_scene.xml`, including the mobile base and laboratory |
| AGV campus streets | `/?variant=agv-campus` | `rs_agv_campus_scene.xml`, with three apartment buildings, a junction and service bays |

Switch configurations at the top of the page. In AGV mode, drive with WASD / arrow keys, stop with Space, select a floor navigation target, or use “Go to grasp area.” Run grasping tasks after docking. The first load downloads the scene meshes.

The dual-arm tabletop runs preset sorting tasks with MuJoCo contact physics: the left arm places an egg and a spool in the tray while the right arm places an apple and a lime in the basket. Select all objects or a single item, pause/resume, reset, adjust speed, and switch camera views. Natural-language control is not connected; the dedicated tabletop UI currently uses Chinese.

The default cup-and-spoon collaboration has the left arm hold the cup while the right arm grips the spoon handle, inserts the bowl and releases it, before the left arm sets the cup down. This preset and the present-and-return task use RGB-D visual feedback, pose IK and contact-based grasping, with grasp weld constraints disabled. Sorting also uses contact-based grasping. The room includes cabinets, shelves, curtains, chairs and kitchen accessories, with detailed hollow cup/handle and spoon geometry. The task card can collapse while preserving status and progress, and cameras include a room view and a collaboration close-up.

The coffee-and-feeding demo has the left arm collect and hold a cup of coffee while the right arm stirs and brings the spoon to the seated person's mouth. This task uses releasable assisted grasp constraints and is labeled as an assisted-grasp demo. Coffee is visualized without fluid dynamics.

Campus mode adds charging / delivery navigation shortcuts and a follow camera. These bays demonstrate navigation and docking; charging state and delivery jobs are not simulated. The detailed campus is rendered in the browser; native MuJoCo uses simplified building proxies, and ROS / Nav2 campus maps are not configured.

Build and preview locally:

```bash
npm run build
npm run preview
```

The [GitHub Pages workflow](.github/workflows/pages.yml) handles deployment. In the repository's Settings → Pages, select GitHub Actions, then push to `main` or run the workflow manually. The build sets the deployment base path from the current repository name.

See the [web documentation](web_mujoco/README.md) for interaction and loading details.

## Repository Layout and Dependencies

```text
reBot_RS_Sim/
├── web_mujoco/              # Browser UI, MuJoCo WASM, web navigation and grasping
├── rebotarm_mujoco_rs/      # ROS 2 MuJoCo nodes and runtime models (XML / STL)
├── rebotarm_gazebo/         # Gazebo scenes and SLAM / Nav2 launch files for both backends
├── rebotarm_msgs/           # ROS 2 messages, services, and actions
├── RS/                     # Standalone RS URDF / STL; input for Gazebo model generation
├── mobile_base/
│   ├── cad/agv_v1/          # Parametric chassis scripts, STEP / STL, and validation resources
│   └── docs/               # Wheel-option research
├── tools/                  # RS + AGV MuJoCo scene generation
└── docs/                   # Robot-description documentation
```

Main resource dependencies:

```text
Web ────────────────────────────┐
ROS 2 MuJoCo ──────────────────┼─> rebotarm_mujoco_rs/models/
Generated Gazebo robot SDF ──────┘   (Gazebo reads meshes from this directory)

RS/urdf/ReBot_Arm_RS.urdf ─────────> Gazebo SDF generation script
mobile_base/cad/agv_v1/stl/ ───────> MuJoCo AGV scene generation script
```

**The 10 detailed gripper collision STL files shared by RS and DM are kept in `rebotarm_mujoco_rs/models/meshes/`.** The root DM description package and duplicate detailed collision files in the RS description have been removed. The RS URDF retains its own visual and whole-part collision meshes; MuJoCo uses the detailed collision meshes in the runtime directory.

## ROS 2 Simulation

### Environment and Build

For ROS 2 Jazzy, prepare `colcon` and `rosdep`; the Gazebo backend uses Harmonic. Dependencies include Nav2, SLAM Toolbox, RViz, and `ros_gz`, as declared in each package's `package.xml`.

The MuJoCo backend also requires Python `mujoco`, which is currently not declared in `package.xml` and must be installed separately. The Python environment running ROS nodes must be able to import `mujoco`, `numpy`, and `scipy`. The joint-slider window also requires `tkinter`.

Build from the repository root after initializing `rosdep`:

```bash
source /opt/ros/jazzy/setup.bash
rosdep install --from-paths rebotarm_msgs rebotarm_mujoco_rs rebotarm_gazebo --ignore-src -r -y
colcon build --symlink-install --packages-select \
  rebotarm_msgs rebotarm_mujoco_rs rebotarm_gazebo
source install/setup.bash
```

The required runtime XML / STL files are committed, so model regeneration is unnecessary for the first launch. Source the ROS and workspace environments in each new terminal.

### Choose a Workflow

Run one simulation backend and one workflow at a time:

| Workflow | MuJoCo | Gazebo |
| --- | --- | --- |
| Laboratory and robot | `mujoco_lab.launch.py` | `lab_world.launch.py` |
| Online mapping | `mujoco_slam.launch.py` | `lab_slam.launch.py` |
| Mapping and navigation | `mujoco_slam_nav.launch.py` | `lab_slam_nav.launch.py` |
| Localization and navigation with an existing map | `mujoco_navigation.launch.py` | `lab_navigation.launch.py` |

All launch files above belong to `rebotarm_gazebo`. For example:

```bash
ros2 launch rebotarm_gazebo mujoco_slam_nav.launch.py
```

For headless navigation, add `use_viewer:=false use_rviz:=false` to the MuJoCo command or `gui:=false use_rviz:=false` to the Gazebo command. The default navigation map is `rebotarm_gazebo/maps/rebotarm_lab.yaml`.

For the arm driver, cameras, and task interfaces, use the core launch entry point:

```bash
ros2 launch rebotarm_mujoco_rs mujoco_rs.launch.py \
  simulation_mode:=physics use_viewer:=true
```

The core entry point enables the simulation driver and task tools by default. `mujoco_lab.launch.py` disables these tools by default to focus on base navigation. Start the joint sliders in another terminal:

```bash
ros2 launch rebotarm_mujoco_rs joint_slider_gui.launch.py
```

The main navigation topics are `/cmd_vel`, `/clock`, `/odom`, `/scan`, and `/imu`. MuJoCo publishes the navigation TF chain `odom → base_footprint → base_link → laser / imu_link`; SLAM Toolbox or AMCL publishes `map → odom`. Arm and task topics use the `/rebotarm_rs/` namespace by default.

See the [MuJoCo package documentation](rebotarm_mujoco_rs/README.md) and [laboratory / navigation documentation](rebotarm_gazebo/README.md) for interfaces and parameters.

## Model and CAD Maintenance

| Resource | Purpose |
| --- | --- |
| [`rs_arm.xml`](rebotarm_mujoco_rs/models/rs_arm.xml) | RS arm, gripper, wrist camera, and collision model |
| [`rs_grasp_scene.xml`](rebotarm_mujoco_rs/models/rs_grasp_scene.xml) | Includes `rs_arm.xml` and adds the grasping station |
| [`rs_agv_scene.xml`](rebotarm_mujoco_rs/models/rs_agv_scene.xml) | Generated complete RS + AGV laboratory scene |
| [`RS/urdf/ReBot_Arm_RS.urdf`](RS/urdf/ReBot_Arm_RS.urdf) | Standalone robot description and input for Gazebo SDF generation |
| [`mobile_base/cad/agv_v1/`](mobile_base/cad/agv_v1/README_ZH.md) | Chassis STEP / STL files, assembly references, and dimensions |

After changing the base MuJoCo scenes or chassis STL files, regenerate the AGV scene from the repository root:

```bash
python3 tools/build_rs_agv_model.py
```

The script reads `rs_arm.xml` and `rs_grasp_scene.xml`, copies six chassis STL types into the runtime directory, and generates `rs_agv_scene.xml`. Put persistent scene changes in the inputs or generation script.

After changing the RS URDF or static laboratory layout, update Gazebo models and maps as needed:

```bash
python3 rebotarm_gazebo/scripts/generate_rs_agv_sdf.py
python3 rebotarm_gazebo/scripts/generate_lab_map.py
```

CAD regeneration requires CadQuery. The CAD script's default base-mesh path still points to the old project, so specify the file in this repository explicitly:

```bash
python3 mobile_base/cad/agv_v1/generate_agv_v1.py \
  --repository-base rebotarm_mujoco_rs/models/meshes/base_link.STL
```

URDF / arm meshes use meters; chassis CAD and wrist-bracket meshes use millimeters, with the corresponding scale set in MJCF. Preserve the relative directory structure between URDF and `meshes/`, including filename case. Wheel and fastener models marked `placeholder` are for assembly checks.

## Checks

Run web checks in `web_mujoco/`; ROS is not required:

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

Run ROS 2 model and bridge tests after sourcing the workspace environment:

```bash
colcon test --packages-select rebotarm_mujoco_rs
colcon test-result --verbose
```

## Model Sources

See the [MuJoCo package documentation](rebotarm_mujoco_rs/README.md) for RS MuJoCo model sources and usage boundaries, and the [third-party model notes](rebotarm_mujoco_rs/models/THIRD_PARTY_MODELS.md) for the D405 wrist bracket's source, version, and license. See the [robot-description notes](docs/arm_description.md) for classification and maintenance conventions.

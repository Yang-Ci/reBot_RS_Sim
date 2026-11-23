# ReBot Arm RS 机械描述包

本目录提供 B601-RS 的独立 URDF 与外观、碰撞网格。当前仓库的模型读取和维护规则见 [机械描述说明](../docs/arm_description.md)。

```text
RS/
├── urdf/
│   └── ReBot_Arm_RS.urdf
└── meshes/
    ├── visual/             # 22 个外观分件
    └── shared/             # 10 个外观 / URDF 碰撞共用整件
```

- 当前 RS URDF 使用实测质量和质心。模型总质量为 6.5503 kg，每侧夹爪手指为 55.9 g，滑动行程各为 0–50 mm。 [URDF 源文件](urdf/ReBot_Arm_RS.urdf)
- 每侧 55.9 g 由 43.9 g 金属件及 12.0 g 3D 打印件组成。Pinocchio 中包含六个旋转关节与两个夹爪滑动关节，`nq = nv = 8`。
- [Gazebo SDF 生成脚本](../rebotarm_gazebo/scripts/generate_rs_agv_sdf.py)从该 URDF 读取模型。MuJoCo 单臂、双臂和 AGV 场景使用同一组 RS 惯性参数。
- URDF 使用 `../meshes/...` 相对路径；独立加载时保留整个 `RS/` 的层级和文件名大小写。
- MuJoCo 的 10 个夹爪精细碰撞网格统一保留在 `rebotarm_mujoco_rs/models/meshes/`，不属于本目录的 URDF 依赖。
- URDF 与 MuJoCo 是独立模型；修改其中一份不会自动更新另一份。

从仓库根目录取得 URDF 路径：

```python
from pathlib import Path

urdf_path = Path("RS/urdf/ReBot_Arm_RS.urdf")
```

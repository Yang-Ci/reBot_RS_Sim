# Web MuJoCo

纯网页 MuJoCo WASM 演示：用官方 `@mujoco/mujoco` 在浏览器里提供四种产品配置：

- 标准机械臂（默认）：`rs_grasp_scene.xml`
- 双臂家居桌面：`rs_dual_tabletop_scene.xml`，两只 B601-RS、完整餐厨角、六件桌面物品，支持杯勺协作和分类整理。
- AGV 底盘款：`rs_agv_scene.xml`
- AGV 园区街区：`rs_agv_campus_scene.xml`，三栋居民楼、十字路口和充电 / 配送区域。

页面顶部可直接切换配置，也可用 `?variant=arm` 或 `?variant=agv` 指定。不启动 ROS、不连真机。

双臂场景使用 [`?variant=dual`](http://127.0.0.1:5173/?variant=dual)。默认“杯勺协作”：
左臂夹住杯柄抬起杯子，右臂从上方垂直夹住两个支撑块之间的勺柄中段，
夹指下探至勺柄两侧，确认两侧接触、闭合停稳后再抬起，对准杯口送入，随后松勺、放杯、退臂。
协作使用完整位姿 IK、关节 PD 和纯接触夹持；默认页面全程关闭杯、勺的抓取 weld。
闭合时逐渐施加有限预紧力，读取两指真实接触力，确认夹紧停稳后再抬升；
搬运时监测双侧接触压力中心的漂移和接触丢失，异常会停止。杯子落桌时通过实际桌面支撑力确认承重转移。
松开后依靠杯底、杯壁与勺子的接触支撑。
空心杯与镂空杯耳有独立细节几何，勺头具有凹面；模型没有逐帧传送物品。
任务卡片右上角可收起 / 展开，收起时仍保留任务状态和进度。

“换一组摆放”会改变杯子和勺子的平面位置（X ±10 mm、Y ±8 mm）及朝向（±0.08 rad），
勺子下的两块支撑和端部止挡随勺子一起移动。摆放编号对应固定随机种子，可重复测试；“复位”恢复标准摆放。
杯勺协作默认使用 RGB-D 视觉闭环。俯视与侧上方相机实际渲染颜色和深度像素，结合标定反投影为点云；
按颜色、几何聚类、杯沿圆与勺面模型估计物体位姿。感知模块只接收图像与标定，不接收 body ID 或仿真物体位姿。
抓取位置定义在物体局部坐标中；抓取前重新观察并修正小幅移位，入杯前根据新图像中的勺头—杯口误差修正目标。
释放后先退出双臂，再以间隔至少 0.35 秒的两次图像确认入杯和稳定。遮挡、陈旧帧最多重观察三次，无法确认则停止并显示原因。
手臂自身关节 / 末端反馈用于运动控制和夹持后的预测，接触监测读取 MuJoCo 接触力，
碰撞保护使用 MuJoCo 碰撞模型；这些反馈不会向图像感知提供物体真值，也不作为视觉成功判据。
协作菜单还提供“会合展示后分别归位”：共享取物和持稳动作，先回到原支撑面上方、缓慢下降，
释放后双臂退出相机视野，再从新图像确认两件物品回到原位置。
观察、运动、抓取、持稳、杯口对准 / 插入、释放及稳定复核已拆分为动作模块，两个任务组合复用。
分类整理和标准单臂演示仍使用仿真物体位姿；扰动范围之外的摆放未作通用规划保证。

任务下拉框还提供“接咖啡、搅拌与送勺喂食（演示）”：左臂把空杯移到咖啡机下方，接满后持稳杯子，
右臂入杯搅拌两圈、送勺到坐姿人物嘴边，停留后收回餐勺并放回杯中，最后放杯、退臂。
该任务保留 PR 中的标准摆放与辅助夹持 weld，界面显示“辅助夹持演示”；原有两项任务仍使用 RGB-D 视觉和接触物理夹持。
人物嘴部和送勺轨迹共用 `feeding-layout.js`；咖啡液面、出液流、搅拌涟漪和勺头咖啡由 `coffee-view.js` 随杯勺位姿更新，
采用可视化液体模型，尚未求解流体动力学。复位或切换任务会清空咖啡。

切换“分类整理”后点击“开始整理”，
左臂依次把鸡蛋、线轴放入托盘，右臂依次把苹果、青柠放入收纳篮；也可以单选物品。
两侧独立运行关节 PD 与位姿 IK，在同一个 MuJoCo 模型内步进，物品由夹爪摩擦接触搬运，
分类整理没有使用吸附约束。容器落点及支撑接触确认后才计为完成。
支持暂停 / 继续（空格）、复位（R）、1× / 2× / 4× 速度、桌面 / 协作特写 / 房间全景 / 接咖啡 / 喂食视角 / 俯视和桌面 RGB 相机。

家居场景的视角始终围绕桌面，水平旋转范围为 25°～150°；初始桌面、协作特写和接咖啡视角从桌面右侧观察，避开咖啡机对机械臂的遮挡，并保留继续向右旋转的余量。关闭自由平移，六个预设视角均遵循范围限制。
点击“开始协作”及任务执行过程中保留用户当前视角，可随时手动拖动或点击视角按钮调整。
右侧同时显示桌面俯视、左腕、右腕三个独立实时画面；腕部画面使用模型中的 `left_wrist_rgb` / `right_wrist_rgb` 相机位姿随手臂运动，手机上以三栏显示。
这是预设整理任务，目前没有接入自然语言模型或真机控制。双臂页面当前使用中文界面。

场景 XML 已提交，日常运行不需要 Python。修改基础机械臂模型或桌面布局后，从仓库根目录运行：

```bash
python tools/build_dual_tabletop.py
cd web_mujoco
npm run test:dual
npm run test:cooperation
npm run test:cooperation:robustness
npm run test:motion
npm run test:vision
npm run test:contact
npm run test:vision:extended
npm run test:vision:return
```

扰动回归默认检查标准摆放及 12 个固定种子，覆盖物体平移、朝向与 ±10% 摩擦参数变化、
不规则步进、暂停、复位、不可达目标和抓取前移位后的失败诊断及重试。
`npm run test:cooperation:robustness -- --cases=100` 可扩展样本数，结果输出到
`.reports/cooperation-benchmark.json`（成功率、阶段、耗时、夹持等待、勺柄穿透和关节跟踪误差）。
可用 `--seeds=42,17` 指定需要复现的摆放编号，或用 `--report=路径` 单独保存报告。
该结果只描述上述仿真场景与辅助夹持条件，不代表真实机械臂成功率。
`test:cooperation*` 使用真值位姿隔离检验运动与接触，不能替代图像闭环测试。
`test:contact` 独立验证纯接触模式，逐批检查两个 weld 始终关闭，覆盖 13 组摆放 / 摩擦、
人为滑移和失握停止，以及 3 组会合归位。`test:cooperation*` 保留辅助夹持基线以便比较。
`test:vision` 使用纯接触夹持，用真实浏览器渲染验证多个摆放、深度 / RGB 扰动、丢点、短暂 / 持续遮挡、陈旧帧及抓取前移位，
输出 `.reports/visual-contact.json`；`test:vision:extended` 扩展亮暗光照、蓝 / 暖色釉面、同尺寸直壁杯、
12 mm 抓取前移位、15% 像素条带缺失及杯 / 勺缺失时的拒绝识别；`test:vision:return` 验证第二种任务组合。
这些都是已标定杯勺族的几何拟合，尚不支持任意尺寸、透明杯或多个同类目标。
首次运行时 Linux 可执行 `npx playwright install --with-deps chromium`；Windows 默认使用本机 Chrome。
浏览器测试默认强制 SwiftShader，明确记录软件 GPU；在本机命令后追加 `--hardware` 可使用浏览器选择的实际 GPU。
GitHub Actions 在构建前执行 `test:ci`、`test:loading`、`test:contact`、标准 / 扩展 / 归位视觉测试、`test:visual-ui` 和 `test:camera` 并上传回归报告，检查失败会阻止该次部署；
拉取请求也执行检查，部署仅在主分支推送或手动触发时执行。是否将检查设为合并门槛由仓库分支保护配置决定。

两只机械臂共享网格与材质资源，只有 body、关节和作动器使用左右前缀。
主视角和三路相机共用一个 WebGL 上下文；每路预览以最高 10 帧/秒独立轮流刷新，静止和缩放时也保持更新。慢 GPU 只保留一次在途取图，避免积压；等待取图不会阻止主视角重绘，静止主画面复用上一帧。
滚轮和触控缩放通过相机 `change` 事件触发重绘。运行 `npm run test:camera` 可检查单次及连续缩放、三路画面的实际绘制，以及延迟取图后的响应与恢复。该检查默认使用 SwiftShader，并仅将主画面的像素比例设为 0.5，保留页面布局和相机采样分辨率；在有限超时内等待实际帧更新。在本机可运行 `npm run test:camera -- --hardware` 检查实际 GPU。`window.rebotDual.renderMetrics().previews` 提供每路已绘制帧数和距上次更新的时间。
RGB-D 观测按请求重新采样，像素通过 WebGL2 异步读回，图像处理在 Web Worker 中执行。
相机采样串行排队，等待时不继续堆积绘制；绘制提交和首次着色器编译仍在主线程，软件 GPU 上画面更新可能明显延迟。
双臂家居场景按每个相机的投影误差选择机械臂连杆 / 底座显示精度，超过 0.8 px 时恢复原网格；
夹指、腕部相机、杯子和勺子保留完整几何。背景家具减少曲面细分，碰撞模型和抓取尺寸保持原定义。
`node scripts/benchmark-rendering.mjs --label=full` 与 `--label=balanced` 提供同设备前后对照，
记录主视角 CPU 提交 / GPU 时间、三路相机、三角面数、保留几何数组和 WASM 容量。
原网格与简化网格同时缓存，面数减少不代表所有内存减少；WASM 容量也不等于实际驻留内存。
IK 使用 MuJoCo 解析雅可比；每段动作按五次曲线限制关节速度 0.8 rad/s、加速度 2 rad/s²。
执行前沿双臂同步路径检查碰撞（采样间隔不超过 0.025 rad），执行中每 10 ms 检查意外接触；
沿用模型的相邻连杆排除及指定物体的夹持接触规则，碰撞网格的近似精度仍受原模型限制。
Web / ROS 从仓库中的 `rebotarm_mujoco_rs/rebotarm_mujoco_rs/control_config.json` 读取 SI 单位、关节限制和控制默认值；
保留已验证的 Web / ROS 两套夹爪增益配置及 ROS 参数覆盖能力，没有用参数统一替代真机标定。
纯接触协作另用有夹爪控制力上限、缓慢闭合与预紧力的命名配置，不覆盖上述 Web / ROS 默认值。
控制指令的 J2 / J3 下限均为 0 rad；原 MJCF 硬限位保留 −0.2 rad 的物理余量。
契约检查要求所有控制范围包含于模型硬限位之内，物理余量不会开放为可发送的目标。
房间增加餐边柜、层架、书籍、窗帘、座椅、落地灯和厨房小物；物品增加釉面、金属凹面、果皮与线轴细节。
桌腿接至桌板底面，四边围裙、下横撑与桌板连接件形成完整支撑。
房间、物品和编织篮使用本地几何和程序纹理，房间细节按材质合并。
原生 MuJoCo 打开 XML 时显示简化外观；物理模型保留杯口与杯耳的空隙。

实验室网页将原有的蓝色储物架占位块替换为金属层架、收纳箱和设备盒，
棕色动态障碍块替换为木托盘、双层周转箱和绑带。细节几何按材质合并，
两件道具合计 4 次绘制，无额外纹理下载。外观完全位于原有碰撞包围盒内，
托盘外观每帧跟随 MuJoCo 几何位姿；导航仍使用完整占用轮廓，货架层间不可穿行。
这些细节仅用于网页渲染，原生 MuJoCo / Gazebo 的模型外观保持简化。
箱盖单独占据顶部厚度，避免与箱体顶面共面闪烁；AGV 主视角采用适合米制场景的
近裁剪距离。园区道路、人行道和底色由同一张地面的互不重叠分区绘制；
停靠区、标线和文字在其上分层显示，避免地面深度冲突。

园区模式使用 `?variant=agv-campus`，例如
[本地园区预览](http://127.0.0.1:5173/?variant=agv-campus)。在“产品配置”中选择
“AGV · 园区街区”，可用 WASD 手动驾驶、点击地面导航，或点击“前往充电区”、
“前往配送区”、“前往抓取区”。充电区和配送区目前用于导航停靠演示，不模拟充电电量或物流任务。

园区按米制搭建，占地 30 × 24 m；小车、机械臂和抓取工位保持原有尺寸。
`src/campus-layout.js` 统一定义建筑 / 花箱 / 设施的轮廓、导航边界和停靠位；
`scripts/build-campus-scene.mjs` 据此生成 MuJoCo 碰撞几何，`npm run dev` 和
`npm run build` 会自动更新 XML。建筑碰撞采用覆盖外观的保守包围盒，室内暂不可进入。
原有实验室和标准机械臂配置继续保留。

详细建筑只在网页中加载；原生 MuJoCo 打开园区 XML 时显示简化建筑轮廓。
该模式没有接入 Gazebo / Nav2 的启动配置或重新生成 ROS 占据地图。

建筑来自 MIT 许可的
[ProceduralBuildingsThreeJS](https://github.com/achrefelouafi/ProceduralBuildingsThreeJS)，
采用其中国居民楼 LOD1 几何，提前生成一份 GLB 并由三个楼栋共享。
纹理内嵌、材质转换为标准 glTF PBR，效果与上游完整 Blender 着色器有所不同。
视窗左上角可在“街区视角”和“跟随小车”之间切换，跟随模式仍可拖动旋转、滚轮缩放。
来源、固定提交与许可见 `public/environments/campus/README.md`。

重新生成建筑素材（需要上游源码；日常启动无需 Blender 或上游仓库）：

```bash
node scripts/import-campus-building.mjs /path/to/ProceduralBuildingsThreeJS
node scripts/build-campus-scene.mjs
npm run test:campus
```

网页源码来自 `/home/robot/reBot_Arm_Mujoco-RS/web_mujoco`，模型统一读取当前仓库的
`rebotarm_mujoco_rs/models/`；源项目保持不变。

## 环境

- Linux 或 macOS，Node.js 20.19+
- Chrome 或 Edge

## 启动

```bash
cd web_mujoco
npm install
npm run dev
```

打开 [http://127.0.0.1:5173](http://127.0.0.1:5173)。AGV 款在观察画面左下角调整
行驶和转向速度，使用键盘方向键/WASD 驾驶，松开即停止，空格键立即停车。点击
“设置导航点”后在地面选点，页面会显示避障路径；也可直接点击“前往抓取区”。

本地校验物理（不需要浏览器）：

```bash
npm run smoke
npm run test:loading
npm run test:variants
npm run test:campus
npm run test:timing
npm run test:surfaces
npm run test:explode
```

## Cloudflare Web Analytics

在 Cloudflare 的 Web Analytics 中添加站点，主机名填写 `seeed-projects.github.io`，
复制安装脚本中 `data-cf-beacon` 的 `token` 值。

在实际发布网站的 GitHub 仓库中打开 Settings → Secrets and variables → Actions →
Variables，创建 `CLOUDFLARE_WEB_ANALYTICS_TOKEN`，值设为该站点 Token，
然后重新运行 GitHub Pages 发布工作流。此 Token 是网页中公开的站点标识，
不需要 Cloudflare API 密钥。

生产构建在设置 Token 后会加入 Cloudflare 的延迟加载脚本。未设置时省略统计脚本，
本地 `npm run dev` 也不会加载统计。要验证本地生产构建，可参考 `.env.example`
将 Token 配置在 `.env.local` 中后执行 `npm run build`。
访问线上网站后，在 Cloudflare 的该站点分析面板查看数据；首次数据可能需要几分钟。
仅向自己的 fork 推送，不会更新 `seeed-projects.github.io`，配置需要部署到实际发布仓库。

## 交互功能

- 产品配置：默认保持标准机械臂，可切换到包含四轮底盘、激光雷达、IMU 和实验室场景的 AGV 底盘款。
- AGV 驾驶：观察画面左下角可调整行驶速度和转向速度；默认 0.65 m/s、1.40 rad/s，限幅与 ROS 2 MuJoCo 桥保持一致。
- AGV 仿真按真实经过时间累计 1 ms 物理步，避免街景渲染掉帧时连带降低车速；左下角显示实测仿真倍率与 FPS，正常实时运行约为 `1.00×`。每帧最多补算 250 ms，长时间卡顿会丢弃额外积压时间；切到后台和复位会重置计时，回到页面不会补跑后台时间。抓取控制仍按不超过 12 ms 的仿真间隔更新。
- 网页导航：10 cm 网格 A* 会避开实验室隔墙、货架和实时位置的动态托盘，并以障碍物净空代价让路线趋向通道中间；这套网页规划不会修改 ROS/Nav2 的膨胀系数。
- 移动抓取：点击“前往抓取区”后 AGV 自动规划、行驶并物理锁定停靠位；随后可像标准机械臂款一样选择物体放入收纳区或启动叠叠乐。AGV 工位整体抬高 136 mm，以保持机械臂与桌面的标准相对几何并避免底盘穿桌。
- 爆炸时间线：先播放整机展示动作，再按夹爪、J6 → J1、基座分阶段拆解；支持拖动进度、暂停和反向还原。
- 防重叠布局：最终位置通过 AABB 分离计算保留 14 mm 间距，并保持在地面上方。
- 零件探索：可直接点击模型或从列表选择零件，查看名称、所属组件、关节、材质和用途说明；支持高亮、隔离与清除选择。
- 双相机画面：侧栏显示全局俯视与 RealSense D405 腕部视角，可切换横排或纵列；纵列中的每一路均可折叠，总开关会同时停止渲染并收起画面。
- 干净相机输出：TCP 球体、拖拽目标、误差线、选中框和 HTML 准星仅用于主界面，不进入相机画面。
- 腕部模型：加入经 B601-RS 实机验证的 D405 30° 向下支架、9 mm 光心对齐偏移和相机外壳代理，并提供独立的模型显示开关。
- 爆炸视图和零件选择只改变 Three.js 显示，不修改 MuJoCo 物理状态。

仓库已配置 GitHub Actions workflow。在仓库的 Settings → Pages 中选择 GitHub Actions
作为发布来源后，推送 `main` 分支或手动运行部署 workflow，即可发布。

- 个人仓库 `Yang-Ci/reBot_RS_Sim`：
  [https://yang-ci.github.io/reBot_RS_Sim/](https://yang-ci.github.io/reBot_RS_Sim/)
- 组织仓库同步上游代码后，还需由管理员单独重命名为 `Seeed-Projects/reBot_RS_Sim`，
  才能使用目标网址：
  [https://seeed-projects.github.io/reBot_RS_Sim/](https://seeed-projects.github.io/reBot_RS_Sim/)

workflow 自动使用当前仓库名设置 `GITHUB_PAGES_BASE`，Vite 据此生成子路径部署包；
仓库名为 `reBot_RS_Sim` 时，路径为 `/reBot_RS_Sim/`，改名前和其他 fork 也会使用各自的仓库名。
Sync fork 只同步代码，不会同步仓库名称或 Pages 设置；无需购买域名或设置 Custom domain。


首次打开会下载所选场景的全部网格，请用 Chrome 或 Edge。
XML 和网格下载在连接或连续 8 秒没有新数据时终止当前请求；网络错误、超时及
HTTP 408 / 429 / 5xx 最多重试一次，404 等永久错误直接进入下一种资源回退。
只要持续收到数据，慢连接可以超过 8 秒；下载进度随数据块更新。
取消加载时终止并发请求、跳过重试与格式回退，并清理已写入的临时模型文件；
页面离开时也会取消尚未完成的模型加载。
`loadRsScene` 支持 `signal`，测试可通过 `downloadOptions` 设置停滞超时和重试次数。
`npm run test:loading` 包含停滞、慢连接、取消、格式回退和清理回归。

网格通过 gzip 和 6 路并发下载；WASM 初始化期间允许最多 16 MiB
加在途请求的网格缓冲，避免首批下载等待 WASM。生产缓存按文件内容 hash 更新，
只修改 XML 时不重新下载未变化的网格。
生产构建将二进制 STL 的重复顶点 / 法线去重、索引差分编码后 gzip，浏览器逐字节还原原始 STL；
41 个机械臂网格的压缩资源由 20.82 MB 降至 13.61 MB，不改面数、法线、碰撞或材质。
格式不支持或资源损坏时依次回退原 gzip、原文件；`?variant=dual&meshTransfer=gzip` 可作同包对照。
下载解压后的模型使用 MuJoCo 已导出的内存文件接口批量写入，避免 `MjVFS.addBuffer`
逐字节跨 JS / WASM 接口的开销；加载成功或失败后均清理本次的独立临时目录。
不改变原始网格、碰撞和控制参数；运行时不支持批量接口时自动回退 VFS。
双臂生产页面也注册同一 Service Worker，复用已有的模型逐文件缓存。
生产环境的 `mujoco.wasm` 默认从 jsDelivr CDN 预加载并流式编译，
运行时异步初始化，避免 Chrome 对大模块同步初始化的限制引发重复下载。
CDN 请求失败或连续 8 秒没有响应 / 新数据时回退站内文件；持续有数据的慢网下载可超过 8 秒，
避免健康的慢连接误触发重新下载。
如需强制使用本地文件，可在构建时设置 `VITE_MUJOCO_WASM_CDN=local`。

加载优化的前后实测、缓存范围和验证记录见 [进入等待优化](../docs/startup-optimization-verification.md)。
生产预览启动后，可用同一个测试分别测批量写入与旧接口：

```bash
node scripts/benchmark-startup.mjs --label=memfs --url="http://127.0.0.1:5173/?variant=dual"
node scripts/benchmark-startup.mjs --label=vfs --url="http://127.0.0.1:5173/?variant=dual&modelFiles=vfs"
```

每次测试新建浏览器上下文，再在其中测首次 / 再次打开，记录首次绘制、三路相机、分阶段耗时、
真实 GPU 和缓存条目，输出 `.reports/startup-标签.json`。`--mbps=20 --latency=80` 可额外模拟网络条件。
页面只读诊断接口 `window.rebotDual.startupMetrics()` 提供双臂加载阶段耗时。
`test:loading` 同时检查三个场景、两种加载方式的双臂几何及 100 步物理状态完全一致、
失败清理、下载背压和缓存更新。首次下载仍受用户带宽和 WASM CDN 可达性影响。
真实线上首访审计与受限网络下的同包对照见 [线上首访与传输验证](../docs/deployment-performance-verification.md)。

本地预览生产包：

```bash
cd web_mujoco
GITHUB_PAGES_BASE=/reBot_RS_Sim/ npm run build
npx vite preview
```

## 里程碑（M1–M4）

| 里程碑 | 内容 | 状态 |
|---|---|---|
| **M1** | RS 臂运动学 | 已完成 |
| **M2** | 物理步进 | 已完成 |
| **M3** | 页内抓取 | 已完成 |
| **M4** | 全局俯视与 D405 腕部相机 | 已完成 |

M0（空场景验证 WASM）已跳过，直接加载 RS 抓取场景。

### M1 运动学（已完成）

加载 `rs_grasp_scene.xml`，滑块直接写 `qpos`，再调用 `mj_forward`。没有 `mj_step`。

验收：

- 手臂、桌面、红/蓝/黄物体可见
- J1–J6 连续转动，模型不瞬移（运动学直连）
- 夹爪滑块同时驱动 `joint7` / `joint_left` / `joint_right`
- 复位回到零位

### M2 物理（已完成）

接上与 `mujoco_sync.py` 对齐的 PD：滑块只改目标，`mj_step` 驱动 `<motor>`。物体可被推倒、掉落。提供 Reset。

标准机械臂、双臂和 AGV 均按真实经过时间计算固定物理步数（`timestep=0.001`）；
暂停或隐藏页面时重置时钟，双臂另支持 1× / 2× / 4× 演示速度。

验收：

- 拖 joint2 时手臂有惯性，不瞬移
- 色块受重力，可被碰到
- Reset 回到初始姿态与物体位置

这步之后才算浏览器里代替了原生 MuJoCo 仿真本体。

### M3 页内抓取

读 `red_cube` / `blue_block` / `yellow_cylinder` 的 `xpos`，先将 J2–J6 收拢到安全高位，再按机械臂基座坐标计算目标方位并单独旋转 J1（使用关节范围内的最短转角），最后进入简化笛卡尔接近：开爪 → 到上方 → 下探 → 闭合 → 抬升。目标会放回桌面上的对应颜色收纳区；叠叠乐模式按蓝、红、黄的顺序堆叠。放置阶段使用接触判断，碰到收纳区或已有堆叠层即松开。

叠叠乐每放好一层都会保持撤离高位，先重新规划到非零的高位抓取准备姿态，再规划到下一个物体，不再中途回零。层间准备姿态采用 J1=0、J2=31.6°、J3=15.4°、J4=18.5°、J5=2.7°、J6=0°。成功或失败时，机械臂会读取浏览器主视角的实时方位，用 J1 面向当前用户视角并将 J4 调整到约 45.8°，使腕部相机保持竖直；随后成功动作由 J6 左右扭头、J5 歪头并将夹爪闭合再张开，失败动作执行低头害羞，最后均停在面向用户的高位中姿态。

全局俯视相机使用模型中定义的 70° 垂直视场角，可同时覆盖完整工作台、收纳区和叠叠乐塔顶；网页预览会直接读取 MJCF 相机 FOV，避免渲染参数与模型配置不一致。

在“一键抓取演示”中选择红、蓝、黄目标后，可直接用机械臂自身朝向定义的 WASD
（W 前、S 后、A 左、D 右）或观察画面中的左键拖动
在桌面内移动；选中物体会呼吸发光，右键拖动（或 Shift + 左键拖动）使用轨迹球方式
调整三维姿态。操作提示固定在观察画面左下角，不再单独占用侧栏；控制器会根据旋转后
的包围范围贴合桌面并限制桌面边界和物体重叠，自动抓取运行时会暂时锁定编辑。

验收：

- 点击抓取后物体 `z` 升高
- 不依赖 ROS 视觉话题；成功判据来自 MuJoCo body 位姿

### M4 全局与腕部相机（已完成）

将场景里的 `overhead_rgb` 和安装在 `gripper_end` 上的 `wrist_rgb` 分别离屏渲染到侧栏，两路画面并排显示并由同一个开关控制。颜色检测仍可直接读取 body 位姿，不必依赖 OpenCV。

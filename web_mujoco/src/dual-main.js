import './dual-style.css';
import { loadMujocoModule, loadRsScene } from './load-model.js';
import { createSceneView } from './scene-view.js';
import { MODEL_VARIANTS, switchModelVariant } from './model-variants.js';
import { createDualSimulation, TABLETOP_TASKS } from './dual-simulation.js';
import { COOP_PHASES } from './cup-spoon-cooperation.js';
import { COFFEE_PHASES } from './coffee-feeding-cooperation.js';
import { createSimulationClock } from './simulation-clock.js';
import { createVisualObserver } from './visual-observer.js';
import { COOPERATIVE_TASKS } from './cooperative-actions.js';
import { persistAppShell } from './register-service-worker.js';

document.documentElement.dataset.modelVariant = 'dual';
document.documentElement.lang = 'zh-CN';
document.title = 'reBot · 双臂桌面';
document.body.className = 'dual-page';
document.body.innerHTML = `
  <main class="dual-app">
    <div id="dual-viewport" aria-label="双机械臂桌面仿真，拖动可在房间正面有限旋转，滚轮缩放"></div>
    <header class="dual-header">
      <a class="dual-brand" href="?variant=arm"><span class="dual-brand-symbol">r.</span> reBot <span class="dual-brand-divider">/</span> <span class="dual-brand-sub">Playground</span></a>
      <span class="dual-live"><i></i> MuJoCo 仿真</span>
      <div class="dual-header-actions">
        <label class="dual-sr" for="dual-variant">产品配置</label>
        <select id="dual-variant"><option value="dual">双臂 · 家居桌面</option><option value="arm">标准机械臂</option><option value="agv">AGV 底盘款</option><option value="agv-campus">AGV · 园区街区</option></select>
        <button id="dual-reset" disabled title="复位场景（R）">↻ <span>复位</span></button>
      </div>
    </header>
    <section class="dual-heading">
      <span class="dual-kicker">TABLETOP / 01</span>
      <h1>一起，把生活整理好。</h1>
      <p>两只 reBot，一个默契的工作空间。</p>
      <div class="dual-scene-tags"><span>双 B601-RS</span><span>6 件物品</span><span>双臂协作</span></div>
    </section>
    <div class="dual-view-switch" role="group" aria-label="相机视角">
      <button id="dual-perspective" aria-pressed="true">桌面</button><button id="dual-close" aria-pressed="false">协作特写</button><button id="dual-room" aria-pressed="false">房间全景</button><button id="dual-coffee" aria-pressed="false">接咖啡</button><button id="dual-feeding" aria-pressed="false">喂食视角</button><button id="dual-overhead" aria-pressed="false">俯视</button>
    </div>
    <aside class="dual-cameras" aria-label="相机实时画面">
    <section class="dual-monitor dual-overhead-monitor" aria-label="桌面相机画面">
      <div class="dual-monitor-title"><span>桌面相机</span><span>RGB · TOP</span></div>
      <canvas id="overhead-camera-canvas" width="320" height="240" aria-label="桌面俯视相机"></canvas>
      <div class="dual-arm-state"><span><i class="dual-left-dot"></i> <span id="dual-left-role">左臂 · 持杯</span></span><strong id="dual-left-state">待命</strong></div>
      <div class="dual-arm-state"><span><i class="dual-right-dot"></i> <span id="dual-right-role">右臂 · 送勺</span></span><strong id="dual-right-state">待命</strong></div>
    </section>
    <section class="dual-monitor" aria-label="左腕相机画面">
      <div class="dual-monitor-title"><span><i class="dual-left-dot"></i> 左腕相机</span><span>RGB · L</span></div>
      <canvas id="left-wrist-camera-canvas" width="320" height="240" aria-label="左机械臂腕部摄像头实时画面"></canvas>
    </section>
    <section class="dual-monitor" aria-label="右腕相机画面">
      <div class="dual-monitor-title"><span><i class="dual-right-dot"></i> 右腕相机</span><span>RGB · R</span></div>
      <canvas id="right-wrist-camera-canvas" width="320" height="240" aria-label="右机械臂腕部摄像头实时画面"></canvas>
    </section>
    </aside>
    <section class="dual-dock" aria-label="整理任务控制">
      <div class="dual-task-header"><span class="dual-task-kicker" id="dual-task-title">双臂协作</span><span id="dual-count">准备就绪</span><span id="dual-timer">00:00</span><button id="dual-dock-toggle" aria-expanded="true" aria-controls="dual-task-details" aria-label="收起任务卡片" title="收起任务卡片"><span>收起</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div>
      <div id="dual-task-details">
      <div class="dual-mode-tabs" role="tablist" aria-label="任务类型"><button id="dual-mode-coop" role="tab" aria-selected="true">杯勺协作</button><button id="dual-mode-sort" role="tab" aria-selected="false">分类整理</button><span id="dual-grasp-mode">接触物理夹持</span></div>
      <div class="dual-objects" id="dual-object-list"></div>
      <ol class="dual-coop-phases" id="dual-coop-phases" aria-label="协作步骤"><li>取杯取勺</li><li>抬起会合</li><li>勺子入杯</li><li>放回桌面</li></ol>
      <div class="dual-layout-controls" id="dual-layout-controls"><span id="dual-layout-label">标准摆放</span><button id="dual-layout" disabled title="改变杯子和勺子的位置与朝向">换一组摆放 <span aria-hidden="true">⤨</span></button></div>
      <div class="dual-task-controls">
        <label class="dual-sr" for="dual-task-select">选择整理任务</label>
        <select id="dual-task-select"><option value="cooperation">左臂拿稳杯子，右臂把勺子放进杯中</option></select>
        <label class="dual-sr" for="dual-speed">演示速度</label>
        <select id="dual-speed" aria-label="演示速度"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select>
        <button id="dual-pause" disabled aria-label="暂停演示">Ⅱ</button>
        <button id="dual-start" disabled>开始协作 <span>↗</span></button>
      </div>
      </div>
      <div class="dual-progress"><div id="dual-progress-fill"></div></div>
      <p id="dual-status" role="status" aria-live="polite">正在准备双臂场景…</p>
    </section>
    <footer class="dual-footer"><span>拖动调整视角 · 滚轮缩放</span><span>SPACE 暂停 <span class="dual-footer-separator">/</span> R 复位</span></footer>
    <div class="dual-loading" id="dual-loading" role="status"><div class="dual-spinner"></div><strong>正在布置工作空间</strong><p id="dual-loading-text">加载 MuJoCo 与机械臂模型…</p></div>
  </main>`;

const $ = (id) => document.getElementById(id);
const stages = { idle: '待命', preparing: '准备', aligning: '对准物体', opening: '张开夹爪', approach: '靠近物体', descend: '下降抓取', closing: '夹紧物体', lift: '抬起物体', transfer: '搬运中', place: '放置物体', release: '松开夹爪', retreat: '抬臂避让', settling: '确认放稳', complete: '已完成', failed: '未完成' };
let simulation = null;
let frameId = 0;
let view = null;
let lastUi = 0;
let selected = 'all';
let taskMode = 'cooperation';
let cooperativeTask='spoon-in-cup';
let planning = false;
let nextLayoutSeed = 1;
let simulationClock = null;

function renderTaskMode() {
  const coop = taskMode === 'cooperation';
  $('dual-mode-coop').setAttribute('aria-selected', String(coop));
  $('dual-mode-sort').setAttribute('aria-selected', String(!coop));
  $('dual-task-title').textContent = coop ? `双臂协作 · ${COOPERATIVE_TASKS[cooperativeTask].label}` : '桌面整理';
  $('dual-grasp-mode').textContent = coop ? cooperativeTask === 'coffee-feeding' ? '辅助夹持演示' : 'RGB-D 视觉 · 接触物理夹持' : '接触物理抓取';
  $('dual-object-list').classList.toggle('dual-coop-objects', coop);
  $('dual-object-list').innerHTML = coop
    ? `<div class="dual-object"><i class="dual-cup-icon"></i><span>陶瓷杯</span><small>左臂握住杯柄、保持杯口向上</small></div><div class="dual-object"><i class="dual-spoon-icon"></i><span>金属餐勺</span><small>垂直夹取支撑块之间的勺柄中段</small></div>`
    : TABLETOP_TASKS.map((task) => `<button class="dual-object" data-task="${task.id}" aria-pressed="false"><i style="--object-color:${task.color}"></i><span>${task.label}</span><small>${task.destination}</small><b aria-hidden="true">✓</b></button>`).join('');
  $('dual-task-select').innerHTML = coop
    ? '<option value="spoon-in-cup">左臂拿稳杯子，右臂把勺子放进杯中</option><option value="present-and-return">双臂取杯取勺，会合展示后分别归位</option><option value="coffee-feeding">接咖啡、搅拌与送勺喂食（演示）</option>'
    : `<option value="all">把桌面物品整理到托盘和收纳篮</option>${TABLETOP_TASKS.map((task) => `<option value="${task.id}">把${task.label}放入${task.destination}</option>`).join('')}`;
  $('dual-task-select').value = coop ? cooperativeTask : selected;
  $('dual-coop-phases').innerHTML=cooperativeTask==='coffee-feeding'
    ? '<li>取杯接咖啡</li><li>入杯搅拌</li><li>送勺喂食</li><li>放回桌面</li>'
    : cooperativeTask==='present-and-return'
    ? '<li>取杯取勺</li><li>抬起会合</li><li>两件归位</li><li>退开复核</li>'
    : '<li>取杯取勺</li><li>抬起会合</li><li>勺子入杯</li><li>放回桌面</li>';
  $('dual-coop-phases').hidden = !coop;
  $('dual-layout-controls').hidden = !coop || COOPERATIVE_TASKS[cooperativeTask].standardLayout === true;
  $('dual-start').innerHTML = `${coop ? '开始协作' : '开始整理'} <span>↗</span>`;
  $('dual-left-role').textContent = coop ? '左臂 · 持杯' : '左臂 → 托盘';
  $('dual-right-role').textContent = coop ? '右臂 · 送勺' : '右臂 → 收纳篮';
}
renderTaskMode();

$('dual-variant').addEventListener('change', (event) => switchModelVariant(event.target.value));
$('dual-dock-toggle').addEventListener('click', () => {
  const collapsed = !$('dual-task-details').hidden;
  $('dual-task-details').hidden = collapsed;
  document.querySelector('.dual-dock').classList.toggle('is-collapsed', collapsed);
  $('dual-dock-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('dual-dock-toggle').setAttribute('aria-label', collapsed ? '展开任务卡片' : '收起任务卡片');
  $('dual-dock-toggle').title = collapsed ? '展开任务卡片' : '收起任务卡片';
  $('dual-dock-toggle').querySelector('span').textContent = collapsed ? '展开' : '收起';
});

function renderState() {
  if (!simulation) return;
  const state = simulation.state();
  const coop = taskMode === 'cooperation';
  const collaboration = state.cooperation;
  const coffee = cooperativeTask === 'coffee-feeding';
  const phases = coffee ? COFFEE_PHASES : COOP_PHASES;
  const count = state.completed.length;
  $('dual-count').textContent = state.error ? (coop ? '协作未完成' : '整理未完成') : coop ? collaboration.complete ? '协作完成 ✓' : state.running ? state.paused ? '已暂停' : '双臂同步中' : '准备就绪' : `${count} / 4 完成`;
  const seconds = Math.floor(state.time);
  $('dual-timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const roles = { approach: ['靠近杯柄', '靠近勺柄'], grasp: ['握住杯柄', '夹住勺柄'], lift: ['杯口向上', '抬起餐勺'], align: ['移杯到中央', '转正餐勺'], insert: ['持续持稳', '缓慢插入'], 'return-above':['回到原位上方','回到支撑块上方'], 'return-objects':['归还杯子','归还餐勺'], 'release-spoon': ['持续持稳', '松开餐勺'], 'clear-right': ['持续持稳', '抬臂避让'], 'lower-cup': ['放回杯子', '等待左臂'], 'release-cup': ['松开杯柄', '等待左臂'], retreat: ['抬臂退出', '抬臂退出'], complete: ['已完成', '已完成'] };
  Object.assign(roles, { 'coffee-approach': ['空杯对准出液口', '抬勺等待'], dispense: ['接咖啡', '抬勺等待'], 'coffee-clear': ['移杯离开咖啡机', '抬勺等待'], 'raise-spoon': ['持稳杯子', '抬勺避开杯沿'], stir: ['持续持稳', '搅拌两圈'], withdraw: ['持续持稳', '抬勺离杯'], 'feed-approach': ['持续持稳', '靠近嘴边'], feed: ['持续持稳', '缓慢送勺'], taste: ['持续持稳', '嘴边停留'], 'feed-retreat': ['持续持稳', '收回餐勺'], 'return-spoon': ['持续持稳', '移回杯口'], reinsert: ['持续持稳', '放回杯中'] });
  for (const [index, side] of ['left', 'right'].entries()) $('dual-' + side + '-state').textContent = state.paused ? '已暂停' : coop ? roles[collaboration.phase]?.[index] || '待命' : stages[state.arms[side].stage] || '待命';
  $('dual-mode-coop').disabled = $('dual-mode-sort').disabled = state.running || planning;
  $('dual-reset').disabled = planning;
  $('dual-pause').disabled = !state.running;
  $('dual-pause').textContent = state.paused ? '▶' : 'Ⅱ';
  $('dual-pause').setAttribute('aria-label', state.paused ? '继续演示' : '暂停演示');
  const pending = TABLETOP_TASKS.some((task) => (selected === 'all' || selected === task.id) && !state.completed.includes(task.id));
  $('dual-start').disabled = planning || state.running || (coop ? collaboration.complete : !pending);
  $('dual-task-select').disabled = state.running || planning;
  $('dual-layout').disabled = state.running || planning;
  $('dual-layout-label').textContent = state.layout?.seed === null ? '标准摆放' : `摆放 #${state.layout.seed}`;
  document.querySelectorAll('[data-task]').forEach((button) => {
    const complete = state.completed.includes(button.dataset.task);
    button.disabled = state.running || complete;
    button.classList.toggle('is-complete', complete);
    button.setAttribute('aria-pressed', String(selected === button.dataset.task));
  });
  let progress = count;
  for (const arm of Object.values(state.arms)) if (arm.running && !state.completed.includes(arm.selectedId)) progress += arm.progress;
  $('dual-progress-fill').style.width = `${(coop ? collaboration.progress : progress / 4) * 100}%`;
  const phaseIndex = !coffee && collaboration.phase.startsWith('return-') ? 4 : phases.findIndex((phase) => phase[0] === collaboration.phase);
  const currentStep = coffee ? phaseIndex < 8 ? 0 : phaseIndex < 11 ? 1 : phaseIndex < 15 ? 2 : 3 : phaseIndex < 2 ? 0 : phaseIndex < 4 ? 1 : phaseIndex < 7 ? 2 : 3;
  $('dual-coop-phases').querySelectorAll('li').forEach((node, index) => {
    node.classList.toggle('is-current', state.running && index === currentStep);
    node.classList.toggle('is-done', collaboration.complete || state.running && index < currentStep);
  });
  $('dual-status').classList.toggle('is-error', Boolean(state.error));
  if (planning) $('dual-status').textContent = '正在规划双臂协作姿态…';
  else if (state.error) {
    const failure = collaboration.failure;
    const reasons = { 'planning-failed': '目标姿态超出可达范围', 'cup-not-upright': '杯子倾斜，请重新摆放', 'object-moved-before-grasp': '物品在抓取前移位', 'cup-grasp-out-of-reach': '左臂未到达杯柄', 'spoon-grasp-out-of-reach': '右臂未到达勺柄', 'cup-not-held-upright': '杯子未保持直立', 'spoon-missed-cup-opening': '勺头未对准杯口', 'placement-not-stable': '放置后物品未稳定' };
    const phase = phases.find(entry => entry[0] === failure?.phase)?.[1] || '规划';
    Object.assign(reasons, {'cup-not-under-coffee-spout': '杯口未对准咖啡机出液口', 'stir-left-cup': '搅拌时勺头离开杯口', 'spoon-missed-mouth': '餐勺未到达嘴边'});
    Object.assign(reasons,{'vision-occluded':'相机未能确认杯子或勺子的位置','vision-stale':'相机观测已过期','vision-error':'相机处理失败','vision-alignment-out-of-range':'杯口与勺头的偏差超出纠正范围','trajectory-collision':'规划路径存在碰撞','unexpected-collision':'执行时检测到意外碰撞','contact-slip-detected':'夹持面检测到物品滑动','contact-grasp-lost':'夹爪已失去可靠接触'});
    const reason = reasons[state.error] || (state.error.startsWith('motion-timeout:') ? '动作未在规定时间内完成' : '未满足抓取条件');
    $('dual-status').textContent = coop ? `${phase}：${reason}。${coffee ? '请复位后重试。' : '可重试当前摆放或换一组。'}` : '本次抓取未完成，请复位后重试。';
  }
  else if (state.paused) $('dual-status').textContent = '演示已暂停，点击继续或按空格键恢复。';
  else if (coop && state.running) $('dual-status').textContent = collaboration.label;
  else if (coop && coffee && collaboration.complete) $('dual-status').textContent = '接咖啡、搅拌和送勺完成，杯内保留咖啡，餐勺已放回。';
  else if (coop && coffee) $('dual-status').textContent = '左臂接咖啡并持稳杯子，右臂搅拌后送勺到嘴边。点击开始协作。';
  else if (coop && collaboration.complete) $('dual-status').textContent = cooperativeTask==='present-and-return'?'视觉复核通过：杯子和餐勺已分别归位，双臂均已松开。':'视觉复核通过：餐勺已入杯，杯子已放稳，双臂均已松开。';
  else if (coop) $('dual-status').textContent = cooperativeTask==='present-and-return'?'双臂取杯取勺，会合展示后送回各自的原位。点击开始协作。':'左臂拿稳杯子，右臂把勺子放进杯中。点击开始协作。';
  else if (state.running) $('dual-status').textContent = '整理进行中 · 左臂收纳到托盘，右臂收纳到篮子。';
  else if (count === 4) $('dual-status').textContent = '桌面整理完成。点击复位，可以再来一次。';
  else if (count) $('dual-status').textContent = '物品已放好，可以继续整理剩余物品。';
  else $('dual-status').textContent = '点击开始，让双臂一起整理；也可以点选一件物品。';
}

function reset() {
  simulation?.reset();
  simulationClock?.reset();
  renderState();
}

$('dual-reset').addEventListener('click', reset);
$('dual-layout').addEventListener('click', () => {
  if (!simulation || planning || simulation.state().running) return;
  simulation.setCooperationLayout(nextLayoutSeed++);
  simulationClock?.reset();
  renderState();
});
$('dual-start').addEventListener('click', () => {
  if (!simulation || planning) return;
  if (taskMode === 'cooperation') {
    planning = true; renderState();
    setTimeout(() => {
      try { simulation.startCooperation({task:cooperativeTask}); }
      finally { planning = false; simulationClock?.reset(); renderState(); }
    }, 50);
  } else { simulation.start(selected === 'all' ? undefined : [selected]); renderState(); }
});
$('dual-pause').addEventListener('click', () => { simulation?.togglePause(); renderState(); });
$('dual-task-select').addEventListener('change', (event) => {
  if(taskMode==='cooperation') {cooperativeTask=event.target.value;simulation?.reset();simulationClock?.reset();renderTaskMode();}
  else selected=event.target.value;
  renderState();
});
for (const [id, mode] of [['dual-mode-coop', 'cooperation'], ['dual-mode-sort', 'sorting']]) $(id).addEventListener('click', () => {
  if (simulation?.state().running || planning) return;
  taskMode = mode; selected = 'all'; simulation?.reset(); simulationClock?.reset(); renderTaskMode(); renderState();
});
$('dual-object-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-task]');
  if (!button || button.disabled) return;
  selected = selected === button.dataset.task ? 'all' : button.dataset.task;
  $('dual-task-select').value = selected;
  renderState();
});
window.addEventListener('keydown', (event) => {
  if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(event.target.tagName) || event.ctrlKey || event.altKey || event.metaKey || event.repeat) return;
  if (event.code === 'Space') { event.preventDefault(); simulation?.togglePause(); renderState(); }
  if (event.code === 'KeyR') reset();
});
const views = {
  'dual-coffee': [[1.5, .95, 1.85], [.32, -.10, .98]],
  'dual-feeding': [[1.25, -.25, 1.65], [.25, .42, 1.00]],
  'dual-perspective': [MODEL_VARIANTS.dual.view.position, MODEL_VARIANTS.dual.view.target],
  'dual-close': [[1.45, .90, 1.80], [.29, .01, .94]],
  'dual-room': [[3.0, -3.2, 2.7], [.28, .28, .98]],
  'dual-overhead': [[.3, -.001, 2.9], [.24, 0, .83]]
};
function selectView(id) {
  view?.setViewPreset(...views[id]);
  for (const key of Object.keys(views)) $(key).setAttribute('aria-pressed', String(key === id));
}
for (const id of Object.keys(views)) $(id).addEventListener('click', () => selectView(id));

async function main() {
  const bootBegan=performance.now();
  const loadingController = new AbortController();
  const cancelLoading = () => loadingController.abort();
  window.addEventListener('pagehide', cancelLoading, { once: true });
  const { mujoco, model, data, materialProps,startup } = await loadRsScene(loadMujocoModule(), (progress) => {
    const vars = progress.vars || {};
    $('dual-loading-text').textContent = vars.total ? `下载模型 ${vars.done} / ${vars.total} · ${vars.mb} MB` : progress.key === 'status.compiling' ? '编译双臂物理场景…' : '准备 MuJoCo 运行环境…';
  }, { sceneXml: MODEL_VARIANTS.dual.sceneXml, signal: loadingController.signal })
    .finally(() => window.removeEventListener('pagehide', cancelLoading));
  const viewBegan=performance.now();
  view = createSceneView($('dual-viewport'), {...MODEL_VARIANTS.dual.view,
    meshDetail:import.meta.env.DEV&&new URLSearchParams(location.search).get('meshDetail')==='full'?'full':'balanced'});
  view.build(mujoco, model, materialProps);
  startup.viewBuildMs=performance.now()-viewBegan;
  view.setOverheadCameraEnabled(true);
  view.setWristCameraEnabled(true, 'left');
  view.setWristCameraEnabled(true, 'right');
  simulation = createDualSimulation(mujoco, model, data,{graspMode:'contact'});
  const observer=createVisualObserver(view,data);
  simulation.setObservationProvider(options=>observer.observe(options));
  simulation.step(300);
  startup.controlsReadyMs=performance.now()-bootBegan;
  $('dual-reset').disabled = false;
  $('dual-loading').hidden = true;
  simulationClock = createSimulationClock(model.opt.timestep);
  document.addEventListener('visibilitychange', () => simulationClock.reset());
  function frame(now) {
    if (document.hidden) simulationClock.reset();
    else {
      const steps = simulationClock.steps(now, { speed: Number($('dual-speed').value), paused: planning || simulation.state().paused || simulation.state().cooperation.vision.waiting });
      if (steps) simulation.step(steps);
      view.sync(data);
      view.setCoffeeState(simulation.state().cooperation);
      view.render();
      startup.firstFrameMs??=performance.now()-bootBegan;
      if (now - lastUi > 100) { renderState(); lastUi = now; }
    }
    frameId = requestAnimationFrame(frame);
  }
  renderState();
  frameId = requestAnimationFrame(frame);
  void persistAppShell().catch(error=>console.warn('页面缓存未完成：',error));
  // Keep a read-only snapshot available for integration checks and diagnostics.
  window.rebotDual = { state: () => simulation.state(), renderMetrics:()=>view.getRenderMetrics(),startupMetrics:()=>({...startup}) };
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    cancelAnimationFrame(frameId); observer.dispose(); simulation.dispose(); view.dispose(); data.delete(); model.delete();
  });
}

main().catch((error) => {
  console.error(error);
  $('dual-loading').hidden = true;
  $('dual-status').textContent = '场景加载失败，请检查网络后刷新页面。';
  $('dual-status').classList.add('is-error');
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import loadMujoco from '@mujoco/mujoco';
import { bindJoints } from '../src/kinematics.js';
import { createPhysicsController } from '../src/pd-control.js';
import { createTcpIk } from '../src/tcp-ik.js';
import { createGraspDemo } from '../src/grasp-demo.js';
import { validateGraspReobservation } from '../src/grasp-reobservation.js';

const root = new URL('../../rebotarm_mujoco_rs/models/', import.meta.url);
const scene = await readFile(new URL('rs_grasp_scene.xml', root), 'utf8');
const arm = await readFile(new URL('rs_arm.xml', root), 'utf8');
const mujoco = await loadMujoco(), vfs = new mujoco.MjVFS();
vfs.addBuffer('rs_grasp_scene.xml', new TextEncoder().encode(scene));
vfs.addBuffer('rs_arm.xml', new TextEncoder().encode(arm));
for (const match of arm.matchAll(/\sfile="([^"]+\.(?:stl|obj|msh))"/gi)) {
  vfs.addBuffer(`meshes/${match[1]}`, await readFile(new URL(`meshes/${match[1]}`, root)));
}
const model = mujoco.MjModel.from_xml_string(scene, vfs), data = new mujoco.MjData(model);
mujoco.mj_forward(model, data);
const joints = bindJoints(mujoco, model), physics = createPhysicsController(mujoco, model, data, joints);
const ik = createTcpIk(mujoco, model, data, joints);
const blue = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, 'blue_block');
const qpos = model.jnt_qposadr[model.body_jntadr[blue]];
const pose = () => ({ source: 'yolo-rgbd', position: { x: data.xpos[blue*3], y: data.xpos[blue*3+1], z: data.xpos[blue*3+2] },
  yaw: 0, timestamp: data.time, capturedAtMs: performance.now(), confidence: .9 });

try {
  for (const scenario of ['small-move', 'large-move', 'occluded', 'cancel']) {
    physics.reset(); physics.step(200);
    const first = pose();
    let signal, resolvePending, calls = 0;
    const stages = new Set();
    const demo = createGraspDemo({ mujoco, model, data, joints, physics, ik,
      onChange: state => stages.add(state.stage),
      reobserveGrasp: async (id, requestSignal) => {
        assert.equal(id, 'blue'); calls++; signal = requestSignal;
        if (scenario === 'cancel') return new Promise(resolve => { resolvePending = resolve; });
        if (scenario === 'occluded') return null;
        data.qpos[qpos] += scenario === 'small-move' ? 0.01 : 0.04;
        mujoco.mj_forward(model, data);
        return pose();
      }
    });
    assert(demo.start('blue', first));
    for (let i = 0; i < 3200 && demo.isRunning(); i++) {
      demo.update();
      if (demo.state().stage === 'reobserving') {
        // Let the asynchronous camera request run without advancing simulation time.
        await new Promise(resolve => setImmediate(resolve));
        if (scenario === 'cancel') {
          assert(resolvePending); demo.cancel(); assert(signal.aborted);
          resolvePending(pose());
          await new Promise(resolve => setImmediate(resolve));
          break;
        }
      }
      physics.step(12);
    }
    const state = demo.state();
    assert.equal(calls, 1);
    if (scenario === 'small-move') {
      assert(stages.has('correcting-approach'));
      assert(Math.abs(state.objectStart.x - first.position.x - .01) < .001);
      assert.equal(state.stage, 'complete', `${state.stage}: ${state.message}`);
    } else if (scenario === 'cancel') assert.equal(state.stage, 'idle');
    else {
      assert.equal(state.stage, 'failed');
      assert.equal(state.message, scenario === 'large-move' ? 'vision-moved' : 'vision-unreliable');
      assert(!stages.has('descend'));
    }
    console.log(`${scenario}: ${state.stage} ${state.message}`);
  }
  const previous = { source:'yolo-rgbd', position:{x:.34,y:.06,z:.119}, yaw:0, timestamp:1, capturedAtMs:100 };
  const next = { ...previous, position:{...previous.position}, timestamp:2, capturedAtMs:200 };
  assert.equal(validateGraspReobservation(previous, {...next, yaw:Math.PI}, Math.PI, 2, 201), null);
  assert.equal(validateGraspReobservation(previous, {...next, yaw:Math.PI/4}, Math.PI, 2, 201), 'vision-orientation');
  assert.equal(validateGraspReobservation(previous, {...next, timestamp:1}, Math.PI, 2, 201), 'vision-unreliable');
  assert.equal(validateGraspReobservation(previous, next, Math.PI, 2, 4201), 'vision-unreliable');
} finally { ik.dispose?.(); data.delete(); model.delete(); vfs.delete(); }

import { Quaternion, Vector3 } from 'three';
import { ARM_JOINTS } from './kinematics.js';
import { motionBlend } from './motion-safety.js';
import { createPosePlanner } from './pose-ik.js';

const FINAL_DESCENT = 0.025;
const SAMPLE_SPACING = 0.008;
const MAX_POSITION_ERROR = 0.003;
const MAX_ROTATION_ERROR = 0.06;
const MAX_SAMPLE_JUMP = 0.35;
const MAX_JOINT_SPEED = 1.6;
const VISUAL_PLACEMENT_MARGIN = 0.008;
const Z_AXIS = new Vector3(0, 0, 1);
const Y_AXIS = new Vector3(0, 1, 0);
const DOWN = new Quaternion().setFromAxisAngle(Y_AXIS, Math.PI / 2);

export function graspOrientation(data, bodyId) {
  const [w, x, y, z] = data.xquat.subarray(bodyId * 4, bodyId * 4 + 4);
  return new Quaternion(x, y, z, w);
}

function interpolateAngles(from, to, fraction) {
  return Object.fromEntries(ARM_JOINTS.map(({ name }) => [name,
    from[name] + (to[name] - from[name]) * fraction]));
}

function motion(waypoints) {
  const distances = [0];
  for (let index = 1; index < waypoints.length; index++) {
    const travel = Math.max(...ARM_JOINTS.map(({ name }) =>
      Math.abs(waypoints[index][name] - waypoints[index - 1][name])));
    distances.push(distances[index - 1] + travel);
  }
  const total = distances.at(-1);
  // A quintic time curve peaks at 1.875 times its average speed. Parameterize
  // by joint travel so one slow segment does not set the pace for every sample.
  const duration = Math.max(0.8, 1.875 * total / MAX_JOINT_SPEED);
  return {
    duration,
    anglesAt(elapsed) {
      if (elapsed >= duration || total === 0) return waypoints.at(-1);
      const position = motionBlend(elapsed / duration) * total;
      const end = distances.findIndex((distance) => distance > position);
      if (end < 0) return waypoints.at(-1);
      const fraction = (position - distances[end - 1]) / (distances[end] - distances[end - 1]);
      return interpolateAngles(waypoints[end - 1], waypoints[end], fraction);
    }
  };
}

function solvePose(planner, position, rotation, seed) {
  const result = planner.solve(position, rotation, seed);
  return result && result.positionError <= MAX_POSITION_ERROR && result.rotationError <= MAX_ROTATION_ERROR
    ? result.angles : null;
}

function descentPath(planner, start, target, initialOrientation, orientation, startAngles, alignmentSeed = null) {
  const height = start.z - target.z;
  if (height <= FINAL_DESCENT) return null;
  const alignSamples = alignmentSeed ? 1 : Math.ceil((height - FINAL_DESCENT) / SAMPLE_SPACING);
  const descendSamples = Math.ceil(FINAL_DESCENT / SAMPLE_SPACING);
  const waypoints = [startAngles];
  for (let index = 1; index <= alignSamples + descendSamples; index++) {
    const alignment = Math.min(index / alignSamples, 1);
    const descent = Math.max(0, (index - alignSamples) / descendSamples);
    const position = [
      start.x + (target.x - start.x) * alignment,
      start.y + (target.y - start.y) * alignment,
      start.z - (height - FINAL_DESCENT) * alignment - FINAL_DESCENT * descent
    ];
    const rotation = initialOrientation.clone().slerp(orientation, motionBlend(alignment));
    const seed = waypoints.at(-1);
    const jointSpaceAlignment = alignmentSeed && index === 1;
    const angles = solvePose(planner, position, rotation, jointSpaceAlignment ? alignmentSeed : seed);
    if (!angles) return null;
    if (!jointSpaceAlignment && ARM_JOINTS.some(({ name }) => Math.abs(angles[name] - seed[name]) > MAX_SAMPLE_JUMP)) return null;
    waypoints.push(angles);
  }
  return {
    orientation,
    descent: motion(waypoints),
    ascent: motion(waypoints.slice(alignSamples).reverse())
  };
}

export function planGraspDescent({ mujoco, model, data, joints, ik, startAngles, object, target, bearing, drop, dropBearing, observation }) {
  const start = ik.tcpPosition();
  const initialOrientation = graspOrientation(data, ik.bodyId);

  // The local Y axis closes the jaws. For boxes align it with a face normal;
  // the cylinder has no preferred yaw. Either sign of a jaw axis is valid.
  let objectYaw = observation?.yaw;
  if (objectYaw === undefined) {
    const matrix = data.xmat.subarray(object.bodyId * 9, object.bodyId * 9 + 9);
    objectYaw = Math.atan2(matrix[3], matrix[0]);
  }
  const period = object.graspYawPeriod;
  const yaw = period ? objectYaw + Math.round((bearing - objectYaw) / period) * period : bearing;
  const radialPitchAxis = new Vector3(-Math.sin(bearing), Math.cos(bearing), 0);
  const bearingChange = new Quaternion().setFromAxisAngle(Z_AXIS, dropBearing - bearing);
  const dropZ = drop.z + target.z - (observation?.position.z ?? data.xpos[object.bodyId * 3 + 2]);
  const planner = createPosePlanner(mujoco, model, data, joints, ik.bodyId);

  try {
    // The wrist cannot point straight down throughout the workspace. Prefer
    // vertical and try a small outward tilt where the joint limits require it.
    for (const tilt of [0, 10, 20, 25, 30, 35, 40]) {
      const orientation = new Quaternion().setFromAxisAngle(radialPitchAxis, -tilt * Math.PI / 180)
        .multiply(new Quaternion().setFromAxisAngle(Z_AXIS, yaw)).multiply(DOWN);
      // Keep the object upright when placing it: the pickup and drop wrist
      // poses differ by yaw only. Check the destination before committing.
      const dropOrientation = bearingChange.clone().multiply(orientation);
      const dropAngles = solvePose(planner, [drop.x, drop.y, dropZ], dropOrientation, startAngles);
      if (!dropAngles) continue;
      const dropSeed = solvePose(planner, [drop.x, drop.y, dropZ + FINAL_DESCENT], dropOrientation, dropAngles);
      if (!dropSeed) continue;
      if (observation && period) {
        // Boxes use a fixed face alignment, so leave reach margin for a
        // small shift inside the jaws. Cylinders can rotate freely in yaw.
        const margin = VISUAL_PLACEMENT_MARGIN;
        const farther = [drop.x + margin * Math.cos(dropBearing), drop.y + margin * Math.sin(dropBearing),
          dropZ + FINAL_DESCENT + margin];
        if (!solvePose(planner, farther, dropOrientation, dropSeed)) continue;
      }
      const plan = descentPath(planner, start, target, initialOrientation, orientation, startAngles);
      if (plan) return { ...plan, dropOrientation, dropSeed };
    }
    return null;
  } finally {
    planner.dispose();
  }
}

export function planGraspPlacement({ mujoco, model, data, joints, ik, startAngles, object, drop, dropOrientation, dropSeed }) {
  const start = ik.tcpPosition();
  const hand = graspOrientation(data, ik.bodyId);
  const inverseHand = hand.clone().invert();
  const localOffset = new Vector3(object.position.x - start.x, object.position.y - start.y, object.position.z - start.z)
    .applyQuaternion(inverseHand);
  const predictedUp = Z_AXIS.clone().applyQuaternion(graspOrientation(data, object.bodyId))
    .applyQuaternion(inverseHand).applyQuaternion(dropOrientation);
  const uprightHand = new Quaternion().setFromUnitVectors(predictedUp, Z_AXIS).multiply(dropOrientation);
  const planner = createPosePlanner(mujoco, model, data, joints, ik.bodyId);
  try {
    // Retry nearby headings about world Z, which preserve the object's up axis.
    const nearbyHeadings = [-15, 15, -30, 30].map(degrees =>
      new Quaternion().setFromAxisAngle(Z_AXIS, degrees * Math.PI / 180).multiply(uprightHand));
    for (const orientation of [uprightHand, dropOrientation, ...nearbyHeadings]) {
      const offset = localOffset.clone().applyQuaternion(orientation);
      const target = { x: drop.x - offset.x, y: drop.y - offset.y, z: drop.z - offset.z };
      // Align above the support before beginning the final vertical descent.
      for (const seed of [startAngles, dropSeed]) {
        const plan = descentPath(planner, start, target, hand, orientation, startAngles, seed);
        if (plan) return { ...plan, target };
      }
    }
    return null;
  } finally {
    planner.dispose();
  }
}

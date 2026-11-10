// Limits apply to the change between two independently measured poses.
export const MAX_GRASP_REOBSERVATION_SHIFT = 0.025;
const MAX_HEIGHT_CHANGE = 0.006;
const MAX_YAW_CHANGE = 20 * Math.PI / 180;
export const MAX_GRASP_FRAME_AGE_MS = 4000;

export function validateGraspReobservation(previous, next, period, requestedAt, nowMs, simulationTime) {
  if (!next || next.source !== 'yolo-rgbd' ||
      ![next.position?.x, next.position?.y, next.position?.z, next.yaw,
        next.timestamp, next.capturedAtMs].every(Number.isFinite) ||
      next.timestamp < requestedAt - 0.05 || next.timestamp <= previous.timestamp ||
      (Number.isFinite(simulationTime) && next.timestamp > simulationTime + 0.002) ||
      nowMs < next.capturedAtMs || nowMs - next.capturedAtMs > MAX_GRASP_FRAME_AGE_MS) return 'vision-unreliable';
  if (Math.hypot(next.position.x - previous.position.x, next.position.y - previous.position.y) > MAX_GRASP_REOBSERVATION_SHIFT ||
      Math.abs(next.position.z - previous.position.z) > MAX_HEIGHT_CHANGE) return 'vision-moved';
  if (period) {
    const difference = next.yaw - previous.yaw;
    const nearest = difference - Math.round(difference / period) * period;
    if (Math.abs(nearest) > MAX_YAW_CHANGE) return 'vision-orientation';
  }
  return null;
}

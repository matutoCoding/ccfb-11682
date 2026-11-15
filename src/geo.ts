import { Collar, Survey } from './types';

const D2R = Math.PI / 180;

export interface TracePoint {
  depth: number;
  x: number;
  y: number;
  z: number;
}

/**
 * 方位角/倾角 -> 单位方向向量。
 * 坐标系: x 东, y 北, z 向上。方位角自北顺时针, 倾角水平为 0 向下为正。
 */
export function dirFromAzDip(azimuth: number, dip: number): [number, number, number] {
  const a = azimuth * D2R;
  const d = dip * D2R;
  return [Math.cos(d) * Math.sin(a), Math.cos(d) * Math.cos(a), -Math.sin(d)];
}

/**
 * 最小曲率法 (minimum curvature / balanced tangential) 计算钻孔轨迹。
 * 返回从孔口到孔底的轨迹点序列 (按测深递增)。
 */
export function desurvey(collar: Collar, surveys: Survey[]): TracePoint[] {
  const ss = surveys
    .filter((s) => s.holeId === collar.holeId)
    .sort((a, b) => a.depth - b.depth);
  const start: TracePoint = { depth: 0, x: collar.x, y: collar.y, z: collar.z };
  if (ss.length === 0) return [start];

  // 若第一个测点不在孔口, 假定孔口到第一测点姿态不变
  const stations =
    ss[0].depth > 0
      ? [{ depth: 0, azimuth: ss[0].azimuth, dip: ss[0].dip }, ...ss]
      : ss;

  const pts: TracePoint[] = [{ depth: stations[0].depth, x: collar.x, y: collar.y, z: collar.z }];
  let prevDir = dirFromAzDip(stations[0].azimuth, stations[0].dip);

  for (let i = 1; i < stations.length; i++) {
    const md = stations[i].depth - stations[i - 1].depth;
    if (md <= 0) continue;
    const dir = dirFromAzDip(stations[i].azimuth, stations[i].dip);
    const cosDog = Math.max(-1, Math.min(1, prevDir[0] * dir[0] + prevDir[1] * dir[1] + prevDir[2] * dir[2]));
    const dog = Math.acos(cosDog);
    const rf = dog > 1e-10 ? (2 / dog) * Math.tan(dog / 2) : 1;
    const f = (md / 2) * rf;
    const prev = pts[pts.length - 1];
    pts.push({
      depth: stations[i].depth,
      x: prev.x + f * (prevDir[0] + dir[0]),
      y: prev.y + f * (prevDir[1] + dir[1]),
      z: prev.z + f * (prevDir[2] + dir[2]),
    });
    prevDir = dir;
  }
  if (pts[0].depth > 0) pts.unshift(start);
  return pts;
}

/** 在轨迹上按测深线性插值位置 (超出范围时取端点) */
export function positionAtDepth(trace: TracePoint[], depth: number): [number, number, number] {
  if (trace.length === 0) return [0, 0, 0];
  if (depth <= trace[0].depth) return [trace[0].x, trace[0].y, trace[0].z];
  const last = trace[trace.length - 1];
  if (depth >= last.depth) return [last.x, last.y, last.z];
  let lo = 0;
  let hi = trace.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (trace[mid].depth <= depth) lo = mid;
    else hi = mid;
  }
  const a = trace[lo];
  const b = trace[hi];
  const t = (depth - a.depth) / (b.depth - a.depth);
  return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t];
}

/** 把轨迹按固定步长细分 (用于画线 / 采样) */
export function subdivideTrace(trace: TracePoint[], step: number, maxDepth: number): TracePoint[] {
  if (trace.length === 0) return [];
  const end = Math.min(maxDepth > 0 ? maxDepth : Infinity, trace[trace.length - 1].depth);
  const out: TracePoint[] = [];
  for (let d = 0; d < end; d += step) {
    const [x, y, z] = positionAtDepth(trace, d);
    out.push({ depth: d, x, y, z });
  }
  const [x, y, z] = positionAtDepth(trace, end);
  out.push({ depth: end, x, y, z });
  return out;
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

/** 由全部轨迹点计算数据范围, 并向外扩 margin 比例 */
export function computeBounds(traces: TracePoint[][], margin = 0.1): Bounds | null {
  let has = false;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const tr of traces) {
    for (const p of tr) {
      has = true;
      min[0] = Math.min(min[0], p.x); max[0] = Math.max(max[0], p.x);
      min[1] = Math.min(min[1], p.y); max[1] = Math.max(max[1], p.y);
      min[2] = Math.min(min[2], p.z); max[2] = Math.max(max[2], p.z);
    }
  }
  if (!has) return null;
  for (let i = 0; i < 3; i++) {
    const span = Math.max(max[i] - min[i], 1e-6);
    min[i] -= span * margin;
    max[i] += span * margin;
  }
  return { min, max };
}

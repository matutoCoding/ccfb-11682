import { GridModel } from './types';

/** 三线性插值采样网格; 超出范围或邻近无数据时返回 NaN */
export function sampleGridTrilinear(m: GridModel, x: number, y: number, z: number): number {
  const gx = (x - m.origin[0]) / m.spacing[0];
  const gy = (y - m.origin[1]) / m.spacing[1];
  const gz = (z - m.origin[2]) / m.spacing[2];
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const z0 = Math.floor(gz);
  if (x0 < 0 || y0 < 0 || z0 < 0 || x0 >= m.nx - 1 || y0 >= m.ny - 1 || z0 >= m.nz - 1) return NaN;
  const fx = gx - x0;
  const fy = gy - y0;
  const fz = gz - z0;
  const at = (i: number, j: number, k: number) => m.grades[(k * m.ny + j) * m.nx + i];
  const c000 = at(x0, y0, z0), c100 = at(x0 + 1, y0, z0);
  const c010 = at(x0, y0 + 1, z0), c110 = at(x0 + 1, y0 + 1, z0);
  const c001 = at(x0, y0, z0 + 1), c101 = at(x0 + 1, y0, z0 + 1);
  const c011 = at(x0, y0 + 1, z0 + 1), c111 = at(x0 + 1, y0 + 1, z0 + 1);
  const vals = [c000, c100, c010, c110, c001, c101, c011, c111];
  for (const v of vals) if (!Number.isFinite(v)) return NaN;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c00 = lerp(c000, c100, fx);
  const c10 = lerp(c010, c110, fx);
  const c01 = lerp(c001, c101, fx);
  const c11 = lerp(c011, c111, fx);
  const c0 = lerp(c00, c10, fy);
  const c1 = lerp(c01, c11, fy);
  return lerp(c0, c1, fz);
}

/** 网格品位直方图 (忽略 NaN) */
export function histogram(m: GridModel, bins = 64): { counts: Uint32Array; min: number; max: number } {
  const counts = new Uint32Array(bins);
  const { min, max } = m;
  const span = max - min;
  if (!(span > 0)) return { counts, min, max };
  for (let i = 0; i < m.grades.length; i++) {
    const g = m.grades[i];
    if (!Number.isFinite(g)) continue;
    let b = Math.floor(((g - min) / span) * bins);
    if (b >= bins) b = bins - 1;
    counts[b]++;
  }
  return { counts, min, max };
}

/** 网格统计信息 */
export function gridStats(m: GridModel): { min: number; max: number; mean: number; validCount: number; nanCount: number } {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < m.grades.length; i++) {
    const g = m.grades[i];
    if (!Number.isFinite(g)) continue;
    valid++;
    sum += g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  return {
    min: valid ? min : NaN,
    max: valid ? max : NaN,
    mean: valid ? sum / valid : NaN,
    validCount: valid,
    nanCount: m.grades.length - valid,
  };
}

/** 归一化打包为 rg8: r = 归一化品位, g = 有效掩码 (体渲染纹理用) */
export function packVolumeRG8(m: GridModel): Uint8Array {
  const n = m.nx * m.ny * m.nz;
  const out = new Uint8Array(n * 2);
  const span = m.max - m.min;
  const inv = span > 1e-12 ? 1 / span : 0;
  for (let i = 0; i < n; i++) {
    const g = m.grades[i];
    if (Number.isFinite(g)) {
      out[i * 2] = Math.round(Math.max(0, Math.min(1, (g - m.min) * inv)) * 255);
      out[i * 2 + 1] = 255;
    } else {
      out[i * 2] = 0;
      out[i * 2 + 1] = 0;
    }
  }
  return out;
}

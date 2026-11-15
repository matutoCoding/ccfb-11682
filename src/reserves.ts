import { GradeUnit } from './types';

export interface ReserveResult {
  cutoff: number;
  voxelCount: number;  // 矿体体素数
  volume: number;      // 矿石体积 m^3
  tonnage: number;     // 矿石量 t
  avgGrade: number;    // 平均品位
  metal: number;       // 金属量: 单位为 % 时是吨, 为 g/t 时是千克
  metalUnit: 't' | 'kg';
}

/**
 * 按边界品位计算矿体体积与金属量。
 * grades 中 NaN 视为无数据, 不参与统计。
 */
export function computeReserves(
  grades: ArrayLike<number>,
  spacing: [number, number, number],
  cutoff: number,
  density: number,
  unit: GradeUnit,
): ReserveResult {
  const voxelVol = spacing[0] * spacing[1] * spacing[2];
  let count = 0;
  let sum = 0;
  for (let i = 0; i < grades.length; i++) {
    const g = grades[i];
    if (Number.isFinite(g) && g >= cutoff) {
      count++;
      sum += g;
    }
  }
  const volume = count * voxelVol;
  const tonnage = volume * density;
  const avgGrade = count > 0 ? sum / count : 0;
  const metal = unit === '%' ? (tonnage * avgGrade) / 100 : (tonnage * avgGrade) / 1000;
  return { cutoff, voxelCount: count, volume, tonnage, avgGrade, metal, metalUnit: unit === '%' ? 't' : 'kg' };
}

/** 对一组边界品位批量计算 (用于储量报表) */
export function sweepReserves(
  grades: ArrayLike<number>,
  spacing: [number, number, number],
  cutoffs: number[],
  density: number,
  unit: GradeUnit,
): ReserveResult[] {
  return cutoffs.map((c) => computeReserves(grades, spacing, c, density, unit));
}

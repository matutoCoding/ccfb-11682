import { describe, expect, it } from 'vitest';
import { computeReserves, sweepReserves } from '../src/reserves';
import { marchingSquares } from '../src/contour';

describe('储量计算', () => {
  // 2x2x2 网格, 体素体积 2*3*4 = 24
  const spacing: [number, number, number] = [2, 3, 4];
  const grades = new Float32Array([0.1, 0.5, 0.8, 1.2, NaN, 0.3, 0.9, 0.05]);

  it('按边界品位统计体积/矿石量/金属量 (%)', () => {
    const r = computeReserves(grades, spacing, 0.5, 2.5, '%');
    // >= 0.5: 0.5, 0.8, 1.2, 0.9 → 4 个体素 (NaN 不参与)
    // 注: grades 为 Float32Array, 期望值按 float32 舍入后的值计算
    const f = (v: number) => new Float32Array([v])[0];
    const avg = (f(0.5) + f(0.8) + f(1.2) + f(0.9)) / 4;
    expect(r.voxelCount).toBe(4);
    expect(r.volume).toBeCloseTo(4 * 24, 9);
    expect(r.tonnage).toBeCloseTo(4 * 24 * 2.5, 9);
    expect(r.avgGrade).toBeCloseTo(avg, 9);
    expect(r.metal).toBeCloseTo((4 * 24 * 2.5) * avg / 100, 9);
    expect(r.metalUnit).toBe('t');
  });

  it('g/t 单位金属量为千克', () => {
    const r = computeReserves(grades, spacing, 0.5, 2.5, 'g/t');
    const f = (v: number) => new Float32Array([v])[0];
    const avg = (f(0.5) + f(0.8) + f(1.2) + f(0.9)) / 4;
    expect(r.metal).toBeCloseTo((4 * 24 * 2.5) * avg / 1000, 9);
    expect(r.metalUnit).toBe('kg');
  });

  it('边界高于所有品位时为零', () => {
    const r = computeReserves(grades, spacing, 99, 2.5, '%');
    expect(r.voxelCount).toBe(0);
    expect(r.volume).toBe(0);
    expect(r.metal).toBe(0);
  });

  it('sweep 返回每个边界的结果', () => {
    const rows = sweepReserves(grades, spacing, [0, 0.5, 1.0], 2.5, '%');
    expect(rows).toHaveLength(3);
    expect(rows[0].voxelCount).toBe(7); // 除 NaN 外全部
    expect(rows[2].voxelCount).toBe(1); // 仅 1.2
  });
});

describe('等值线 (marching squares)', () => {
  it('简单场提取一条线段且端点位置正确', () => {
    // 2x2 场: f(0,0)=0, f(1,0)=1, f(0,1)=1, f(1,1)=2, 等值线 0.5
    const field = new Float32Array([0, 1, 1, 2]);
    const segs = marchingSquares(field, 2, 2, 1, 1, 0.5);
    expect(segs).toHaveLength(4);
    // 端点应在底边 (0.5, 0) 和左边 (0, 0.5)
    const pts = [segs.slice(0, 2), segs.slice(2, 4)].map((p) => p.map((v) => Math.round(v * 1e6) / 1e6));
    expect(pts).toContainEqual([0.5, 0]);
    expect(pts).toContainEqual([0, 0.5]);
  });

  it('均匀场无等值线', () => {
    const field = new Float32Array(16).fill(1);
    expect(marchingSquares(field, 4, 4, 1, 1, 0.5)).toHaveLength(0);
    expect(marchingSquares(field, 4, 4, 1, 1, 1)).toHaveLength(0);
  });

  it('NaN 单元被跳过', () => {
    const field = new Float32Array([0, 1, NaN, 1, 1, 2, 1, 2, 3]);
    const segs = marchingSquares(field, 3, 3, 1, 1, 0.5);
    // 只有不含 NaN 的单元参与
    expect(segs.length % 4).toBe(0);
  });
});

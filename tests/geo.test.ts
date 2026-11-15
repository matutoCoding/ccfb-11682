import { describe, expect, it } from 'vitest';
import { desurvey, dirFromAzDip, positionAtDepth, subdivideTrace } from '../src/geo';

const collar = { holeId: 'ZK1', x: 1000, y: 2000, z: 100, maxDepth: 100 };

describe('钻孔轨迹计算 (最小曲率法)', () => {
  it('直孔垂直向下: 轨迹为直线', () => {
    const trace = desurvey(collar, [
      { holeId: 'ZK1', depth: 0, azimuth: 0, dip: 90 },
      { holeId: 'ZK1', depth: 100, azimuth: 0, dip: 90 },
    ]);
    const end = trace[trace.length - 1];
    expect(end.x).toBeCloseTo(1000, 6);
    expect(end.y).toBeCloseTo(2000, 6);
    expect(end.z).toBeCloseTo(0, 6);
  });

  it('45° 定向孔 (方位 90°=正东): 水平位移与垂深符合三角关系', () => {
    const trace = desurvey(collar, [
      { holeId: 'ZK1', depth: 0, azimuth: 90, dip: 45 },
      { holeId: 'ZK1', depth: 100, azimuth: 90, dip: 45 },
    ]);
    const end = trace[trace.length - 1];
    const d = 100 * Math.cos(Math.PI / 4);
    expect(end.x).toBeCloseTo(1000 + d, 4);
    expect(end.y).toBeCloseTo(2000, 4);
    expect(end.z).toBeCloseTo(100 - d, 4);
  });

  it('变斜段: 轨迹点落在两测点之间且连续', () => {
    const trace = desurvey(collar, [
      { holeId: 'ZK1', depth: 0, azimuth: 0, dip: 90 },
      { holeId: 'ZK1', depth: 50, azimuth: 0, dip: 60 },
      { holeId: 'ZK1', depth: 100, azimuth: 0, dip: 45 },
    ]);
    expect(trace).toHaveLength(3);
    // 中间点 z 应介于 100 和 100-50=50 之间, 且小于直线下来的 50 (上段更陡)
    expect(trace[1].z).toBeLessThan(100);
    expect(trace[1].z).toBeGreaterThan(40);
    expect(trace[2].depth).toBe(100);
  });

  it('positionAtDepth 线性插值与端点截断', () => {
    const trace = desurvey(collar, [
      { holeId: 'ZK1', depth: 0, azimuth: 0, dip: 90 },
      { holeId: 'ZK1', depth: 100, azimuth: 0, dip: 90 },
    ]);
    expect(positionAtDepth(trace, 50)[2]).toBeCloseTo(50, 6);
    expect(positionAtDepth(trace, -10)[2]).toBeCloseTo(100, 6);
    expect(positionAtDepth(trace, 500)[2]).toBeCloseTo(0, 6);
  });

  it('subdivideTrace 按步长细分', () => {
    const trace = desurvey(collar, [
      { holeId: 'ZK1', depth: 0, azimuth: 0, dip: 90 },
      { holeId: 'ZK1', depth: 100, azimuth: 0, dip: 90 },
    ]);
    const pts = subdivideTrace(trace, 10, 100);
    expect(pts).toHaveLength(11);
    expect(pts[10].z).toBeCloseTo(0, 6);
  });

  it('方向向量: 方位 0°=北, 90°=东, 倾角 90°=垂直向下', () => {
    const [x0, y0] = [dirFromAzDip(0, 0), dirFromAzDip(90, 0)];
    expect(x0[0]).toBeCloseTo(0, 10);
    expect(x0[1]).toBeCloseTo(1, 10);
    expect(y0[0]).toBeCloseTo(1, 10);
    expect(y0[1]).toBeCloseTo(0, 10);
    const down = dirFromAzDip(0, 90);
    expect(down[2]).toBeCloseTo(-1, 10);
  });
});

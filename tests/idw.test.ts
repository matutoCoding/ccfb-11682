import { describe, expect, it } from 'vitest';
import { IDWParams, SampleIndex, idwGridInto, idwIndexed, idwNaive } from '../src/idw';
import { mulberry32 } from '../src/ui';

function randomSamples(n: number, seed: number): Float64Array {
  const rand = mulberry32(seed);
  const s = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    s[i * 4] = rand() * 1000;
    s[i * 4 + 1] = rand() * 1000;
    s[i * 4 + 2] = rand() * 300;
    s[i * 4 + 3] = rand() * 3;
  }
  return s;
}

describe('IDW 插值: 加速实现 vs 独立参考实现', () => {
  const cases: { name: string; params: IDWParams }[] = [
    { name: '幂2 + 半径150 + 最多8点', params: { power: 2, maxDist: 150, maxPoints: 8 } },
    { name: '幂3 + 半径400 + 不限点数', params: { power: 3, maxDist: 400, maxPoints: 0 } },
    { name: '幂1.5 + 不限半径 + 最多12点', params: { power: 1.5, maxDist: 0, maxPoints: 12 } },
    { name: '幂2 + 不限半径 + 不限点数', params: { power: 2, maxDist: 0, maxPoints: 0 } },
  ];

  for (const c of cases) {
    it(`单点核对 (${c.name}), 误差 < 1e-6`, () => {
      const samples = randomSamples(500, 12345);
      const index = new SampleIndex(samples, Math.max(c.params.maxDist, 1));
      const rand = mulberry32(999);
      let maxDiff = 0;
      for (let k = 0; k < 2000; k++) {
        const x = rand() * 1000;
        const y = rand() * 1000;
        const z = rand() * 300;
        const ref = idwNaive(samples, x, y, z, c.params);
        const got = c.params.maxDist > 0
          ? idwIndexed(samples, index, x, y, z, c.params)
          : idwNaive(samples, x, y, z, c.params);
        if (Number.isNaN(ref) && Number.isNaN(got)) continue;
        expect(Number.isNaN(got)).toBe(Number.isNaN(ref));
        maxDiff = Math.max(maxDiff, Math.abs(got - ref));
      }
      expect(maxDiff).toBeLessThan(1e-6);
    });
  }

  it('整网格核对, 误差 < 1e-6', () => {
    const samples = randomSamples(300, 777);
    const params: IDWParams = { power: 2, maxDist: 250, maxPoints: 16 };
    const nx = 12, ny = 10, nz = 8;
    const origin: [number, number, number] = [50, 60, 10];
    const spacing: [number, number, number] = [80, 90, 35];
    const out = new Float32Array(nx * ny * nz);
    idwGridInto(samples, nx, ny, nz, origin, spacing, params, out);

    let maxDiff = 0;
    let ptr = 0;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const ref = idwNaive(
            samples,
            origin[0] + i * spacing[0],
            origin[1] + j * spacing[1],
            origin[2] + k * spacing[2],
            params,
          );
          const got = out[ptr++];
          if (Number.isNaN(ref) && Number.isNaN(got)) continue;
          expect(Number.isNaN(got)).toBe(Number.isNaN(ref));
          maxDiff = Math.max(maxDiff, Math.abs(got - ref));
        }
      }
    }
    expect(maxDiff).toBeLessThan(1e-6);
  });

  it('精确命中样本点时返回该样本值', () => {
    const samples = randomSamples(50, 5);
    const params: IDWParams = { power: 2, maxDist: 0, maxPoints: 0 };
    const v = idwNaive(samples, samples[0], samples[1], samples[2], params);
    expect(v).toBe(samples[3]);
  });

  it('搜索半径外无样本时返回 NaN', () => {
    const samples = randomSamples(50, 6);
    const params: IDWParams = { power: 2, maxDist: 1, maxPoints: 0 };
    const v = idwNaive(samples, 10000, 10000, 10000, params);
    expect(Number.isNaN(v)).toBe(true);
  });

  it('单一样本时任意点都等于该样本值', () => {
    const samples = new Float64Array([10, 20, 30, 1.5]);
    const params: IDWParams = { power: 2, maxDist: 0, maxPoints: 0 };
    expect(idwNaive(samples, 0, 0, 0, params)).toBeCloseTo(1.5, 12);
    expect(idwNaive(samples, 999, -50, 33, params)).toBeCloseTo(1.5, 12);
  });
});

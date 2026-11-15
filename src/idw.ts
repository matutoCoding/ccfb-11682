/**
 * 反距离加权 (IDW) 插值。
 *
 * idwNaive   —— 逐点全量扫描的参考实现 (独立实现, 用于核对)。
 * idwIndexed —— 基于均匀网格空间索引的加速实现。
 *
 * 两个实现对同一查询点选取完全相同的邻域样本集合
 * (按 (距离, 样本序号) 排序后取前 maxPoints 个), 并以相同顺序
 * 做 float64 累加, 因此结果差异在浮点舍入量级 (远小于 1e-6)。
 */

export interface IDWParams {
  power: number;      // 幂次 p, 权重 w = 1 / d^p
  maxDist: number;    // 搜索半径, <=0 表示不限
  maxPoints: number;  // 参与加权的最大样本数, <=0 表示不限
}

/** 样本数组: 步长 4 的 Float64Array [x, y, z, value, ...] */
export type Samples = Float64Array;

interface Neighbor {
  d: number;
  i: number;
}

function collectNeighbors(
  samples: Samples,
  indices: Iterable<number>,
  px: number,
  py: number,
  pz: number,
  maxDist: number,
): Neighbor[] {
  const out: Neighbor[] = [];
  const useR = maxDist > 0;
  const r2 = maxDist * maxDist;
  for (const i of indices) {
    const o = i * 4;
    const dx = samples[o] - px;
    const dy = samples[o + 1] - py;
    const dz = samples[o + 2] - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (useR && d2 > r2) continue;
    out.push({ d: Math.sqrt(d2), i });
  }
  return out;
}

function weightFromNeighbors(samples: Samples, nb: Neighbor[], params: IDWParams): number {
  if (nb.length === 0) return NaN;
  // 精确命中: 取样本序号最小者的值 (两种实现行为一致)
  let exact = -1;
  for (const n of nb) {
    if (n.d === 0 && (exact < 0 || n.i < exact)) exact = n.i;
  }
  if (exact >= 0) return samples[exact * 4 + 3];

  nb.sort((a, b) => (a.d - b.d) || (a.i - b.i));
  const m = params.maxPoints > 0 ? Math.min(params.maxPoints, nb.length) : nb.length;
  const p = params.power;
  let sw = 0;
  let sv = 0;
  for (let k = 0; k < m; k++) {
    const w = 1 / Math.pow(nb[k].d, p);
    sw += w;
    sv += w * samples[nb[k].i * 4 + 3];
  }
  return sv / sw;
}

function* allIndices(samples: Samples): Generator<number> {
  const n = samples.length / 4;
  for (let i = 0; i < n; i++) yield i;
}

/** 参考实现: 全量扫描, 结果作为核对基准 */
export function idwNaive(samples: Samples, px: number, py: number, pz: number, params: IDWParams): number {
  const nb = collectNeighbors(samples, allIndices(samples), px, py, pz, params.maxDist);
  return weightFromNeighbors(samples, nb, params);
}

/** 均匀网格空间索引。单元边长 = 搜索半径, 因此任一点半径内的样本必落在相邻 27 个单元内。 */
export class SampleIndex {
  readonly cell: number;
  private map = new Map<number, number[]>();
  private stamp: Uint32Array;
  private qid = 0;
  private scratch: number[] = [];

  constructor(samples: Samples, maxDist: number) {
    this.cell = maxDist > 0 ? maxDist : 1;
    const n = samples.length / 4;
    this.stamp = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const key = this.keyOf(samples[o], samples[o + 1], samples[o + 2]);
      let arr = this.map.get(key);
      if (!arr) {
        arr = [];
        this.map.set(key, arr);
      }
      arr.push(i);
    }
  }

  private keyOf(x: number, y: number, z: number): number {
    const ix = Math.floor(x / this.cell);
    const iy = Math.floor(y / this.cell);
    const iz = Math.floor(z / this.cell);
    // 整数散列; 碰撞只会多取候选, 不影响正确性 (仍有距离过滤与样本去重)
    return ((ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)) | 0;
  }

  /**
   * 返回查询点半径 maxDist 内的全部候选样本序号 (上确界集合)。
   * 不同单元可能散列到同一 key, 这里用查询戳记按样本去重, 保证同一样本不被重复计入。
   * 注意: 返回的是内部复用数组, 下次调用即失效 (本模块内均为立即消费)。
   */
  candidates(px: number, py: number, pz: number): number[] {
    const cx = Math.floor(px / this.cell);
    const cy = Math.floor(py / this.cell);
    const cz = Math.floor(pz / this.cell);
    const qid = ++this.qid;
    const out = this.scratch;
    out.length = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = (((cx + dx) * 73856093) ^ ((cy + dy) * 19349663) ^ ((cz + dz) * 83492791)) | 0;
          const arr = this.map.get(key);
          if (!arr) continue;
          for (const i of arr) {
            if (this.stamp[i] !== qid) {
              this.stamp[i] = qid;
              out.push(i);
            }
          }
        }
      }
    }
    return out;
  }
}

/** 加速实现: 空间索引 + 与参考实现完全相同的邻域选取与加权 */
export function idwIndexed(
  samples: Samples,
  index: SampleIndex,
  px: number,
  py: number,
  pz: number,
  params: IDWParams,
): number {
  const nb = collectNeighbors(samples, index.candidates(px, py, pz), px, py, pz, params.maxDist);
  return weightFromNeighbors(samples, nb, params);
}

/**
 * 对整个三维规则网格做插值, 结果写入 out (长度 nx*ny*nz, x 最快)。
 * 无邻域样本的网格点写 NaN。onProgress 每完成一个 z 层回调一次。
 */
export function idwGridInto(
  samples: Samples,
  nx: number,
  ny: number,
  nz: number,
  origin: [number, number, number],
  spacing: [number, number, number],
  params: IDWParams,
  out: Float32Array,
  onProgress?: (doneSlices: number, totalSlices: number) => void,
): void {
  const useIndex = params.maxDist > 0;
  const index = useIndex ? new SampleIndex(samples, params.maxDist) : null;
  let ptr = 0;
  for (let k = 0; k < nz; k++) {
    const pz = origin[2] + k * spacing[2];
    for (let j = 0; j < ny; j++) {
      const py = origin[1] + j * spacing[1];
      for (let i = 0; i < nx; i++) {
        const px = origin[0] + i * spacing[0];
        const v = index
          ? idwIndexed(samples, index, px, py, pz, params)
          : idwNaive(samples, px, py, pz, params);
        out[ptr++] = v;
      }
    }
    onProgress?.(k + 1, nz);
  }
}

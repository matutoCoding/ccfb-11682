import { IDWParams, idwGridInto } from './idw';

export interface InterpRequest {
  samples: Float64Array;
  nx: number;
  ny: number;
  nz: number;
  origin: [number, number, number];
  spacing: [number, number, number];
  params: IDWParams;
}

self.onmessage = (e: MessageEvent<InterpRequest>) => {
  const { samples, nx, ny, nz, origin, spacing, params } = e.data;
  const out = new Float32Array(nx * ny * nz);
  idwGridInto(samples, nx, ny, nz, origin, spacing, params, out, (done, total) => {
    (self as unknown as Worker).postMessage({ type: 'progress', done, total });
  });
  (self as unknown as Worker).postMessage({ type: 'done', buffer: out.buffer }, [out.buffer]);
};

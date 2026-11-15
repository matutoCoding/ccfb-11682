import { GridModel, Project } from './types';
import { desurvey, subdivideTrace } from './geo';
import { lutColor } from './transfer';

/**
 * 构建钻孔轨迹线段顶点数组 (每顶点 7 float: xyz + rgba)。
 * 轨迹按品位段着色 (使用传输函数 LUT), 无品位段为灰色。
 */
export function buildHoleLines(project: Project, model: GridModel | null, lut: Uint8Array): Float32Array {
  const verts: number[] = [];
  const assaysByHole = new Map<string, { from: number; to: number; grade: number }[]>();
  for (const a of project.assays) {
    let arr = assaysByHole.get(a.holeId);
    if (!arr) {
      arr = [];
      assaysByHole.set(a.holeId, arr);
    }
    arr.push(a);
  }
  const span = model ? model.max - model.min : 0;

  for (const c of project.collars) {
    const trace = desurvey(c, project.surveys);
    if (trace.length === 0) continue;
    const maxDepth = c.maxDepth > 0 ? c.maxDepth : trace[trace.length - 1].depth;
    const step = Math.max(maxDepth / 400, 0.5);
    const pts = subdivideTrace(trace, step, maxDepth);
    const assays = assaysByHole.get(c.holeId) ?? [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const md = (a.depth + b.depth) / 2;
      const assay = assays.find((s) => md >= s.from && md < s.to);
      let r = 0.55, g = 0.6, bl = 0.68, alpha = 0.55;
      if (assay && model && span > 1e-12) {
        const t = Math.max(0, Math.min(1, (assay.grade - model.min) / span));
        const [cr, cg, cb] = lutColor(lut, t);
        r = cr / 255; g = cg / 255; bl = cb / 255;
        alpha = 0.95;
      }
      verts.push(a.x, a.y, a.z, r, g, bl, alpha, b.x, b.y, b.z, r, g, bl, alpha);
    }
  }
  return new Float32Array(verts);
}

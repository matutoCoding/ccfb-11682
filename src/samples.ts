import { Project } from './types';
import { TracePoint, desurvey, positionAtDepth } from './geo';

/**
 * 由钻孔品位分段构建 IDW 采样点。
 * 每个品位段沿轨迹按 sampleStep 细分, 取各小段中点作为采样点。
 * 返回步长 4 的 Float64Array [x, y, z, grade, ...]。
 */
export function buildSamples(project: Project): Float64Array {
  const step = Math.max(project.modelParams.sampleStep, 0.1);
  const traces = new Map<string, TracePoint[]>();
  const collarByHole = new Map(project.collars.map((c) => [c.holeId, c]));

  for (const c of project.collars) {
    traces.set(c.holeId, desurvey(c, project.surveys));
  }

  // 先统计点数再一次性填充, 避免频繁扩容
  let count = 0;
  for (const a of project.assays) {
    if (!collarByHole.has(a.holeId)) continue;
    count += Math.max(1, Math.ceil((a.to - a.from) / step));
  }
  const out = new Float64Array(count * 4);
  let ptr = 0;
  for (const a of project.assays) {
    const trace = traces.get(a.holeId);
    if (!trace) continue;
    const n = Math.max(1, Math.ceil((a.to - a.from) / step));
    const segLen = (a.to - a.from) / n;
    for (let i = 0; i < n; i++) {
      const md = a.from + (i + 0.5) * segLen;
      const [x, y, z] = positionAtDepth(trace, md);
      out[ptr++] = x;
      out[ptr++] = y;
      out[ptr++] = z;
      out[ptr++] = a.grade;
    }
  }
  return out;
}

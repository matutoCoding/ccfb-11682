import { Assay, Collar, Survey } from './types';

export interface RowError {
  line: number;    // 1-based 原始行号
  content: string;
  reason: string;
}

export interface ParseResult<T> {
  rows: T[];
  errors: RowError[];
  headerSkipped: boolean;
}

function splitLine(line: string): string[] {
  return line.split(/[,;\t]/).map((s) => s.trim());
}

function parseNum(s: string | undefined): number | null {
  if (s === undefined || s === '') return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/** 判断首行是否为表头: 任一应为数字的列不是数字即视为表头 */
function looksLikeHeader(cols: string[], numericCols: number[]): boolean {
  return numericCols.some((i) => cols[i] !== undefined && cols[i] !== '' && Number.isNaN(Number(cols[i])));
}

function parseCsv<T>(
  text: string,
  numericCols: number[],
  minCols: number,
  build: (cols: string[], nums: (number | null)[], line: number) => T | RowError,
): ParseResult<T> {
  const rows: T[] = [];
  const errors: RowError[] = [];
  const lines = text.split(/\r?\n/);
  let headerSkipped = false;
  let firstDataSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cols = splitLine(line);
    if (!firstDataSeen) {
      firstDataSeen = true;
      if (looksLikeHeader(cols, numericCols)) {
        headerSkipped = true;
        continue;
      }
    }
    if (cols.length < minCols) {
      errors.push({ line: i + 1, content: raw, reason: `列数不足 (需要至少 ${minCols} 列, 实际 ${cols.length} 列)` });
      continue;
    }
    const nums = numericCols.map((c) => parseNum(cols[c]));
    const bad = numericCols.findIndex((c, k) => nums[k] === null);
    if (bad >= 0) {
      errors.push({ line: i + 1, content: raw, reason: `第 ${numericCols[bad] + 1} 列应为数字: "${cols[numericCols[bad]] ?? ''}"` });
      continue;
    }
    const r = build(cols, nums, i + 1);
    if ('reason' in (r as RowError)) errors.push({ ...(r as RowError), content: raw });
    else rows.push(r as T);
  }
  return { rows, errors, headerSkipped };
}

/** 孔口表: 孔号,X,Y,Z[,孔深] */
export function parseCollars(text: string): ParseResult<Collar> {
  return parseCsv<Collar>(text, [1, 2, 3], 4, (cols, nums, line) => {
    const holeId = cols[0];
    if (!holeId) return { line, content: '', reason: '孔号为空' };
    let maxDepth = 0;
    if (cols[4] !== undefined && cols[4] !== '') {
      const v = parseNum(cols[4]);
      if (v === null) return { line, content: '', reason: `孔深应为数字: "${cols[4]}"` };
      if (v < 0) return { line, content: '', reason: '孔深不能为负' };
      maxDepth = v;
    }
    return { holeId, x: nums[0]!, y: nums[1]!, z: nums[2]!, maxDepth };
  });
}

/** 测斜表: 孔号,测深,方位角,倾角 */
export function parseSurveys(text: string): ParseResult<Survey> {
  return parseCsv<Survey>(text, [1, 2, 3], 4, (cols, nums, line) => {
    const holeId = cols[0];
    if (!holeId) return { line, content: '', reason: '孔号为空' };
    const [depth, azimuth, dip] = [nums[0]!, nums[1]!, nums[2]!];
    if (depth < 0) return { line, content: '', reason: '测深不能为负' };
    if (azimuth < 0 || azimuth > 360) return { line, content: '', reason: `方位角应在 0~360: ${azimuth}` };
    if (dip < -90 || dip > 90) return { line, content: '', reason: `倾角应在 -90~90: ${dip}` };
    return { holeId, depth, azimuth, dip };
  });
}

/** 品位表: 孔号,自,至,品位 */
export function parseAssays(text: string): ParseResult<Assay> {
  return parseCsv<Assay>(text, [1, 2, 3], 4, (cols, nums, line) => {
    const holeId = cols[0];
    if (!holeId) return { line, content: '', reason: '孔号为空' };
    const [from, to, grade] = [nums[0]!, nums[1]!, nums[2]!];
    if (from < 0) return { line, content: '', reason: '段首深度不能为负' };
    if (to <= from) return { line, content: '', reason: `段末 (${to}) 必须大于段首 (${from})` };
    if (grade < 0) return { line, content: '', reason: '品位不能为负' };
    return { holeId, from, to, grade };
  });
}

/** 交叉校验: 返回警告信息 (不阻止导入) */
export function crossCheck(
  collars: Collar[],
  surveys: Survey[],
  assays: Assay[],
): string[] {
  const warnings: string[] = [];
  const ids = new Set(collars.map((c) => c.holeId));
  const dup = new Set<string>();
  const seen = new Set<string>();
  for (const c of collars) {
    if (seen.has(c.holeId)) dup.add(c.holeId);
    seen.add(c.holeId);
  }
  if (dup.size) warnings.push(`孔口表存在重复孔号: ${[...dup].join(', ')}`);
  const unknownS = new Set<string>();
  for (const s of surveys) if (!ids.has(s.holeId)) unknownS.add(s.holeId);
  if (unknownS.size) warnings.push(`测斜表引用了孔口表中不存在的孔号: ${[...unknownS].join(', ')}`);
  const unknownA = new Set<string>();
  for (const a of assays) if (!ids.has(a.holeId)) unknownA.add(a.holeId);
  if (unknownA.size) warnings.push(`品位表引用了孔口表中不存在的孔号: ${[...unknownA].join(', ')}`);
  return warnings;
}

/** 全局数据类型定义 */

export interface Collar {
  holeId: string;
  x: number; // 东坐标
  y: number; // 北坐标
  z: number; // 孔口标高
  maxDepth: number; // 孔深 (m)
}

export interface Survey {
  holeId: string;
  depth: number;   // 测深 (m)
  azimuth: number; // 方位角, 度, 自北顺时针
  dip: number;     // 倾角, 度, 水平为 0, 向下为正
}

export interface Assay {
  holeId: string;
  from: number;  // 段首 (m)
  to: number;    // 段末 (m)
  grade: number; // 品位
}

export interface ModelParams {
  nx: number;
  ny: number;
  nz: number;
  power: number;      // IDW 幂次
  maxDist: number;    // 搜索半径 (m), <=0 表示不限
  maxPoints: number;  // 最大采样点数, <=0 表示不限
  sampleStep: number; // 沿孔轨迹采样间距 (m)
}

export interface TFNode {
  pos: number;   // 0..1, 对应品位 min..max
  color: string; // #rrggbb
  alpha: number; // 0..1
}

export type GradeUnit = '%' | 'g/t';

export interface Project {
  id: string;
  name: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  collars: Collar[];
  surveys: Survey[];
  assays: Assay[];
  modelParams: ModelParams;
  tf: TFNode[];
  cutoff: number;   // 边界品位
  density: number;  // 体重 t/m^3
  gradeUnit: GradeUnit;
}

/** 三维规则网格模型 */
export interface GridModel {
  nx: number;
  ny: number;
  nz: number;
  origin: [number, number, number];
  spacing: [number, number, number];
  min: number;
  max: number;
  grades: Float32Array; // x 最快, 然后 y, 然后 z; NaN 表示无数据
}

export function defaultModelParams(): ModelParams {
  return { nx: 128, ny: 128, nz: 128, power: 2, maxDist: 0, maxPoints: 16, sampleStep: 2 };
}

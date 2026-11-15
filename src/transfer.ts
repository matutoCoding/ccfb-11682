import { TFNode } from './types';

/** 默认传输函数节点 */
export function defaultTF(): TFNode[] {
  return [
    { pos: 0.0, color: '#1a2a6c', alpha: 0.0 },
    { pos: 0.3, color: '#2a9d8f', alpha: 0.05 },
    { pos: 0.55, color: '#e9c46a', alpha: 0.3 },
    { pos: 0.8, color: '#e76f51', alpha: 0.7 },
    { pos: 1.0, color: '#ffffff', alpha: 1.0 },
  ];
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [255, 255, 255];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * 由传输函数节点计算 size 级 RGBA 查找表 (每级 4 字节)。
 * 节点按 pos 排序, 相邻节点间线性插值颜色和透明度。
 */
export function computeLUT(nodes: TFNode[], size = 256): Uint8Array {
  const sorted = [...nodes].sort((a, b) => a.pos - b.pos);
  const lut = new Uint8Array(size * 4);
  if (sorted.length === 0) return lut;
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    let a = sorted[0];
    let b = sorted[sorted.length - 1];
    for (let j = 0; j < sorted.length - 1; j++) {
      if (t >= sorted[j].pos && t <= sorted[j + 1].pos) {
        a = sorted[j];
        b = sorted[j + 1];
        break;
      }
    }
    const span = b.pos - a.pos;
    const f = span > 1e-9 ? (t - a.pos) / span : 0;
    const [r1, g1, b1] = hexToRgb(a.color);
    const [r2, g2, b2] = hexToRgb(b.color);
    lut[i * 4 + 0] = Math.round(r1 + (r2 - r1) * f);
    lut[i * 4 + 1] = Math.round(g1 + (g2 - g1) * f);
    lut[i * 4 + 2] = Math.round(b1 + (b2 - b1) * f);
    lut[i * 4 + 3] = Math.round(255 * (a.alpha + (b.alpha - a.alpha) * f));
  }
  return lut;
}

/** 按归一化品位取色 (用于钻孔轨迹着色 / 剖面填色) */
export function lutColor(lut: Uint8Array, t: number): [number, number, number, number] {
  const i = Math.max(0, Math.min(255, Math.round(t * 255)));
  return [lut[i * 4], lut[i * 4 + 1], lut[i * 4 + 2], lut[i * 4 + 3]];
}

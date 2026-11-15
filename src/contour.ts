/**
 * Marching Squares 等值线提取。
 * field: 行优先 (ny 行 nx 列) 标量场, NaN 单元跳过。
 * 返回扁平线段数组 [x1,y1,x2,y2, ...], 坐标为局部网格坐标 (x 列向, y 行向, 单位与 dx/dy 一致)。
 */
export function marchingSquares(
  field: ArrayLike<number>,
  nx: number,
  ny: number,
  dx: number,
  dy: number,
  level: number,
): number[] {
  const segs: number[] = [];
  const at = (i: number, j: number) => field[j * nx + i];

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const v0 = at(i, j);         // 左下
      const v1 = at(i + 1, j);     // 右下
      const v2 = at(i + 1, j + 1); // 右上
      const v3 = at(i, j + 1);     // 左上
      if (!Number.isFinite(v0) || !Number.isFinite(v1) || !Number.isFinite(v2) || !Number.isFinite(v3)) continue;

      let idx = 0;
      if (v0 >= level) idx |= 1;
      if (v1 >= level) idx |= 2;
      if (v2 >= level) idx |= 4;
      if (v3 >= level) idx |= 8;
      if (idx === 0 || idx === 15) continue;

      const x0 = i * dx;
      const y0 = j * dy;
      // 各边交点 (线性插值)
      const lerp = (a: number, b: number) => {
        const t = (level - a) / (b - a);
        return Number.isFinite(t) ? t : 0.5;
      };
      const bottom = (): [number, number] => [x0 + lerp(v0, v1) * dx, y0];
      const right = (): [number, number] => [x0 + dx, y0 + lerp(v1, v2) * dy];
      const top = (): [number, number] => [x0 + lerp(v3, v2) * dx, y0 + dy];
      const left = (): [number, number] => [x0, y0 + lerp(v0, v3) * dy];

      const push = (a: [number, number], b: [number, number]) => {
        segs.push(a[0], a[1], b[0], b[1]);
      };

      switch (idx) {
        case 1: case 14: push(left(), bottom()); break;
        case 2: case 13: push(bottom(), right()); break;
        case 3: case 12: push(left(), right()); break;
        case 4: case 11: push(right(), top()); break;
        case 6: case 9:  push(bottom(), top()); break;
        case 7: case 8:  push(left(), top()); break;
        case 5:  push(left(), top()); push(bottom(), right()); break;
        case 10: push(left(), bottom()); push(right(), top()); break;
      }
    }
  }
  return segs;
}

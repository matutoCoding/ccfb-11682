/** 列主序 4x4 矩阵 (与 WGSL 一致) */
export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function perspective(fovYRad: number, aspect: number, near: number, far: number): Mat4 {
  // WebGPU 裁剪空间 z ∈ [0, 1]
  const f = 1 / Math.tan(fovYRad / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}

export function lookAt(
  eye: [number, number, number],
  center: [number, number, number],
  up: [number, number, number],
): Mat4 {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

/** out = a * b (列主序) */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function invert(m: Mat4): Mat4 {
  const inv = new Float32Array(16);
  const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3];
  const m4 = m[4], m5 = m[5], m6 = m[6], m7 = m[7];
  const m8 = m[8], m9 = m[9], m10 = m[10], m11 = m[11];
  const m12 = m[12], m13 = m[13], m14 = m[14], m15 = m[15];

  const b00 = m0 * m5 - m1 * m4;
  const b01 = m0 * m6 - m2 * m4;
  const b02 = m0 * m7 - m3 * m4;
  const b03 = m1 * m6 - m2 * m5;
  const b04 = m1 * m7 - m3 * m5;
  const b05 = m2 * m7 - m3 * m6;
  const b06 = m8 * m13 - m9 * m12;
  const b07 = m8 * m14 - m10 * m12;
  const b08 = m8 * m15 - m11 * m12;
  const b09 = m9 * m14 - m10 * m13;
  const b10 = m9 * m15 - m11 * m13;
  const b11 = m10 * m15 - m11 * m14;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return mat4Identity();
  det = 1.0 / det;

  inv[0] = (m5 * b11 - m6 * b10 + m7 * b09) * det;
  inv[1] = (m2 * b10 - m1 * b11 - m3 * b09) * det;
  inv[2] = (m13 * b05 - m14 * b04 + m15 * b03) * det;
  inv[3] = (m10 * b04 - m9 * b05 - m11 * b03) * det;
  inv[4] = (m6 * b08 - m4 * b11 - m7 * b07) * det;
  inv[5] = (m0 * b11 - m2 * b08 + m3 * b07) * det;
  inv[6] = (m14 * b02 - m12 * b05 - m15 * b01) * det;
  inv[7] = (m8 * b05 - m10 * b02 + m11 * b01) * det;
  inv[8] = (m4 * b10 - m5 * b08 + m7 * b06) * det;
  inv[9] = (m1 * b08 - m0 * b10 - m3 * b06) * det;
  inv[10] = (m12 * b04 - m13 * b02 + m15 * b00) * det;
  inv[11] = (m9 * b02 - m8 * b04 - m11 * b00) * det;
  inv[12] = (m5 * b07 - m4 * b09 - m6 * b06) * det;
  inv[13] = (m0 * b09 - m1 * b07 + m2 * b06) * det;
  inv[14] = (m13 * b01 - m12 * b03 - m14 * b00) * det;
  inv[15] = (m8 * b03 - m9 * b01 + m10 * b00) * det;
  return inv;
}

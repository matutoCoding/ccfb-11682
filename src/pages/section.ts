import { h, fmt, downloadBlob } from '../ui';
import { getCurrentProject } from '../state';
import { getCurrentModel } from '../state';
import { sampleGridTrilinear } from '../gridutil';
import { marchingSquares } from '../contour';
import { computeLUT } from '../transfer';
import { desurvey, subdivideTrace } from '../geo';
import { GridModel } from '../types';

const RES = 440; // 剖面采样分辨率

export function renderSectionPage(root: HTMLElement): void {
  const project = getCurrentProject();
  root.append(h('h2', {}, '剖面分析'));
  if (!project) {
    root.append(h('div', { class: 'notice' }, '请先选择一个项目。'));
    return;
  }

  let model: GridModel | null = null;

  // ---- 控件 ----
  const azIn = h('input', { type: 'number', value: '90', min: '0', max: '360', step: '5' });
  const dipIn = h('input', { type: 'number', value: '90', min: '0', max: '90', step: '5' });
  const offsetSlider = h('input', { type: 'range', min: '-100', max: '100', step: '1', value: '0', style: 'width:220px' });
  const offsetLabel = h('span', { class: 'dim' }, '0 m');
  const intervalIn = h('input', { type: 'number', value: '0', min: '0', step: '0.05', title: '0 = 自动' });
  const holesCheck = h('input', { type: 'checkbox' }) as HTMLInputElement;
  holesCheck.checked = true;
  const exportBtn = h('button', { class: 'primary' }, '导出剖面图 (PNG)');
  const updateBtn = h('button', {}, '刷新');

  root.append(h('div', { class: 'card' },
    h('div', {},
      h('label', { class: 'field' }, '剖面倾向 (°)', azIn),
      h('label', { class: 'field' }, '剖面倾角 (°)', dipIn),
      h('label', { class: 'field' }, '法向偏移', h('div', { style: 'display:flex;align-items:center;gap:8px' }, offsetSlider, offsetLabel)),
      h('label', { class: 'field' }, '等值线间隔 (0=自动)', intervalIn),
      h('label', { class: 'check', style: 'margin-top:18px' }, holesCheck, '显示钻孔交点'),
    ),
    h('div', { class: 'toolbar' }, updateBtn, exportBtn),
    h('p', { class: 'hint' }, '倾向/倾角按地质产状定义: 倾向为剖面下坡方向方位角, 90° 倾角为直立剖面。偏移沿剖面法线方向。'),
  ));

  const infoBox = h('div', {});
  const canvasWrap = h('div', { class: 'section-canvas-wrap' });
  const canvas = h('canvas', {}) as HTMLCanvasElement;
  canvasWrap.append(canvas);
  root.append(infoBox, canvasWrap);

  let lut = computeLUT(project.tf);

  function computeAndDraw(): void {
    const m = model;
    if (!m) return;
    lut = computeLUT(project!.tf);

    const az = (Number(azIn.value) || 0) * Math.PI / 180;
    const dip = (Number(dipIn.value) || 0) * Math.PI / 180;
    // 平面法线 (倾向 az, 倾角 dip)
    const n: [number, number, number] = [
      -Math.sin(dip) * Math.sin(az),
      -Math.sin(dip) * Math.cos(az),
      Math.cos(dip),
    ];
    // 面内基向量: u 水平, v 向上
    let u: [number, number, number] = [n[1], -n[0], 0]; // cross(n, z) 的简化
    const ul = Math.hypot(u[0], u[1]);
    if (ul < 1e-9) u = [1, 0, 0];
    else { u = [u[0] / ul, u[1] / ul, 0]; }
    const v: [number, number, number] = [
      n[1] * u[2] - n[2] * u[1],
      n[2] * u[0] - n[0] * u[2],
      n[0] * u[1] - n[1] * u[0],
    ];

    const cx = m.origin[0] + (m.nx - 1) * m.spacing[0] / 2;
    const cy = m.origin[1] + (m.ny - 1) * m.spacing[1] / 2;
    const cz = m.origin[2] + (m.nz - 1) * m.spacing[2] / 2;
    const diag = Math.hypot(
      (m.nx - 1) * m.spacing[0],
      (m.ny - 1) * m.spacing[1],
      (m.nz - 1) * m.spacing[2],
    );
    const W = diag * 0.62; // 半宽
    const offset = (Number(offsetSlider.value) / 100) * diag * 0.5;
    offsetLabel.textContent = `${fmt(offset, 1)} m`;
    const p0: [number, number, number] = [cx + n[0] * offset, cy + n[1] * offset, cz + n[2] * offset];

    // 采样
    const cell = (2 * W) / (RES - 1);
    const field = new Float32Array(RES * RES);
    for (let j = 0; j < RES; j++) {
      const tv = -W + j * cell;
      for (let i = 0; i < RES; i++) {
        const tu = -W + i * cell;
        field[j * RES + i] = sampleGridTrilinear(
          m,
          p0[0] + u[0] * tu + v[0] * tv,
          p0[1] + u[1] * tu + v[1] * tv,
          p0[2] + u[2] * tu + v[2] * tv,
        );
      }
    }

    // 绘制
    const barW = 60;
    const padL = 10, padT = 30, padB = 26;
    canvas.width = RES + barW + padL + 16;
    canvas.height = RES + padT + padB;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#10141b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const img = ctx.createImageData(RES, RES);
    const span = m.max - m.min;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const g = field[j * RES + i];
        const px = j * RES + i;
        if (!Number.isFinite(g)) {
          img.data[px * 4] = 16; img.data[px * 4 + 1] = 20; img.data[px * 4 + 2] = 27; img.data[px * 4 + 3] = 255;
          continue;
        }
        const t = span > 1e-12 ? (g - m.min) / span : 0;
        const li = Math.max(0, Math.min(255, Math.round(t * 255))) * 4;
        img.data[px * 4] = lut[li];
        img.data[px * 4 + 1] = lut[li + 1];
        img.data[px * 4 + 2] = lut[li + 2];
        img.data[px * 4 + 3] = 255;
      }
    }
    // 上下翻转 (v 向上)
    const flipped = ctx.createImageData(RES, RES);
    for (let j = 0; j < RES; j++) {
      flipped.data.set(img.data.subarray(j * RES * 4, (j + 1) * RES * 4), (RES - 1 - j) * RES * 4);
    }
    ctx.putImageData(flipped, padL, padT);

    // 等值线
    let interval = Number(intervalIn.value) || 0;
    if (interval <= 0) interval = span / 10 || 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = 1;
    let nLevels = 0;
    for (let lv = Math.ceil(m.min / interval) * interval; lv <= m.max; lv += interval) {
      const segs = marchingSquares(field, RES, RES, cell, cell, lv);
      if (segs.length === 0) continue;
      nLevels++;
      ctx.beginPath();
      for (let s = 0; s < segs.length; s += 4) {
        const x1 = padL + segs[s] / cell;
        const y1 = padT + (RES - 1 - segs[s + 1] / cell);
        const x2 = padL + segs[s + 2] / cell;
        const y2 = padT + (RES - 1 - segs[s + 3] / cell);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }

    // 钻孔交点
    let nHits = 0;
    if (holesCheck.checked) {
      ctx.font = '11px sans-serif';
      for (const c of project!.collars) {
        const trace = desurvey(c, project!.surveys);
        const maxDepth = c.maxDepth > 0 ? c.maxDepth : trace[trace.length - 1].depth;
        const pts = subdivideTrace(trace, Math.max(maxDepth / 300, 0.5), maxDepth);
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const da = (a.x - p0[0]) * n[0] + (a.y - p0[1]) * n[1] + (a.z - p0[2]) * n[2];
          const db = (b.x - p0[0]) * n[0] + (b.y - p0[1]) * n[1] + (b.z - p0[2]) * n[2];
          if (da * db > 0 || da === db) continue;
          const t = da / (da - db);
          const ix = a.x + (b.x - a.x) * t - p0[0];
          const iy = a.y + (b.y - a.y) * t - p0[1];
          const iz = a.z + (b.z - a.z) * t - p0[2];
          const su = ix * u[0] + iy * u[1] + iz * u[2];
          const sv = ix * v[0] + iy * v[1] + iz * v[2];
          if (Math.abs(su) > W || Math.abs(sv) > W) continue;
          const px = padL + ((su + W) / (2 * W)) * (RES - 1);
          const py = padT + (RES - 1) * (1 - (sv + W) / (2 * W));
          ctx.beginPath();
          ctx.arc(px, py, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ff5252';
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.fillText(c.holeId, px + 7, py - 4);
          nHits++;
        }
      }
    }

    // 色标
    const barX = padL + RES + 10;
    const barH = RES;
    for (let j = 0; j < barH; j++) {
      const t = 1 - j / (barH - 1);
      const li = Math.round(t * 255) * 4;
      ctx.fillStyle = `rgb(${lut[li]},${lut[li + 1]},${lut[li + 2]})`;
      ctx.fillRect(barX, padT + j, 18, 1);
    }
    ctx.fillStyle = '#dbe2ec';
    ctx.font = '11px sans-serif';
    ctx.fillText(fmt(m.max, 3), barX + 22, padT + 10);
    ctx.fillText(fmt(m.min, 3), barX + 22, padT + barH - 2);
    ctx.fillText(project!.gradeUnit, barX + 22, padT + barH / 2);

    // 标题与信息
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#dbe2ec';
    ctx.fillText(
      `${project!.name} — 倾向 ${azIn.value}° 倾角 ${dipIn.value}° 偏移 ${fmt(offset, 1)}m`,
      padL, 18,
    );
    ctx.fillStyle = '#8b98ab';
    ctx.font = '11px sans-serif';
    ctx.fillText(`等值线间隔 ${fmt(interval, 3)} ${project!.gradeUnit}, ${nLevels} 条; 钻孔交点 ${nHits} 个`, padL, canvas.height - 8);

    infoBox.innerHTML = '';
    infoBox.append(h('p', { class: 'hint' },
      `剖面尺寸 ${fmt(2 * W, 0)}×${fmt(2 * W, 0)} m, 采样 ${RES}×${RES}。红色圆点为钻孔与剖面的交点。`));
  }

  updateBtn.onclick = computeAndDraw;
  offsetSlider.oninput = () => computeAndDraw();
  exportBtn.onclick = () => {
    canvas.toBlob((b) => {
      if (b) downloadBlob(`剖面_${project!.name}_${azIn.value}_${dipIn.value}.png`, b);
    }, 'image/png');
  };

  void getCurrentModel().then((m) => {
    if (!m) {
      infoBox.append(h('div', { class: 'notice' }, '还没有插值模型, 请先到「插值建模」页运行插值。'));
      return;
    }
    model = m;
    computeAndDraw();
  });
}

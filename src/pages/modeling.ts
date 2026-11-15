import { h, fmt, downloadText } from '../ui';
import { saveProject } from '../store';
import { getCurrentProject } from '../state';
import { getCurrentModel, setCurrentModel } from '../state';
import { buildSamples } from '../samples';
import { computeBounds, desurvey } from '../geo';
import { gridStats } from '../gridutil';
import { computeReserves, sweepReserves } from '../reserves';
import { GridModel } from '../types';
import { InterpRequest } from '../idw.worker';

export function renderModelingPage(root: HTMLElement): () => void {
  const cur = getCurrentProject();
  root.append(h('h2', {}, '插值建模'));
  if (!cur) {
    root.append(h('div', { class: 'notice' }, '请先选择一个项目。'));
    return () => {};
  }
  const project = cur;

  let worker: Worker | null = null;
  let model: GridModel | null = null;

  // ---- 数据摘要 ----
  const traces = project.collars.map((c) => desurvey(c, project.surveys));
  const bounds = computeBounds(traces, 0.1);
  const sampleCount = (() => {
    const step = Math.max(project.modelParams.sampleStep, 0.1);
    let n = 0;
    for (const a of project.assays) n += Math.max(1, Math.ceil((a.to - a.from) / step));
    return n;
  })();

  const summary = h('div', { class: 'stat-grid' },
    stat('钻孔数', String(project.collars.length)),
    stat('品位段数', String(project.assays.length)),
    stat('插值采样点', fmt(sampleCount, 0)),
    stat('数据范围', '—'),
  );
  // 修正范围显示
  summary.lastElementChild!.querySelector('.v')!.textContent = bounds
    ? `${fmt(bounds.max[0] - bounds.min[0], 0)}×${fmt(bounds.max[1] - bounds.min[1], 0)}×${fmt(bounds.max[2] - bounds.min[2], 0)} m`
    : '—';
  root.append(h('div', { class: 'card' }, h('h3', {}, '数据摘要'), summary));

  if (project.assays.length === 0) {
    root.append(h('div', { class: 'notice' }, '还没有品位数据, 请先到「钻孔管理」导入。'));
    return () => {};
  }

  // ---- 网格与参数设置 ----
  const mp = project.modelParams;
  const nxIn = numInput(mp.nx, 16, 512);
  const nyIn = numInput(mp.ny, 16, 512);
  const nzIn = numInput(mp.nz, 16, 512);
  const powerIn = numInput(mp.power, 0.5, 5, 0.5);
  const maxDistIn = numInput(mp.maxDist, 0, 100000, 10);
  const maxPointsIn = numInput(mp.maxPoints, 0, 128, 1);
  const sampleStepIn = numInput(mp.sampleStep, 0.2, 50, 0.5);

  const presetRow = h('div', { class: 'toolbar' }, h('span', { class: 'dim' }, '分辨率预设:'));
  for (const n of [64, 128, 256]) {
    const b = h('button', {}, `${n}³`);
    b.onclick = () => { nxIn.value = nyIn.value = nzIn.value = String(n); };
    presetRow.append(b);
  }

  root.append(h('div', { class: 'card' },
    h('h3', {}, '网格与插值参数'),
    presetRow,
    h('div', {},
      field('X 方向网格数', nxIn), field('Y 方向网格数', nyIn), field('Z 方向网格数', nzIn),
    ),
    h('div', {},
      field('IDW 幂次', powerIn),
      field('搜索半径 (m, 0=不限)', maxDistIn),
      field('最大采样点数 (0=不限)', maxPointsIn),
      field('沿孔采样间距 (m)', sampleStepIn),
    ),
    h('p', { class: 'hint' },
      bounds ? `网格范围 (自动, 外扩 10%): X [${fmt(bounds.min[0], 1)}, ${fmt(bounds.max[0], 1)}], ` +
        `Y [${fmt(bounds.min[1], 1)}, ${fmt(bounds.max[1], 1)}], Z [${fmt(bounds.min[2], 1)}, ${fmt(bounds.max[2], 1)}]` : ''),
  ));

  // ---- 插值执行 ----
  const progressBar = h('div', {});
  const progressText = h('span', { class: 'dim' }, '');
  const runBtn = h('button', { class: 'primary' }, '开始插值');
  const cancelBtn = h('button', {}, '取消');
  cancelBtn.disabled = true;

  const resultBox = h('div', {});
  const reserveBox = h('div', {});

  root.append(h('div', { class: 'card' },
    h('h3', {}, '执行插值'),
    h('div', { class: 'toolbar' }, runBtn, cancelBtn, progressText),
    h('div', { class: 'progress' }, progressBar),
  ));
  root.append(resultBox);
  root.append(reserveBox);

  runBtn.onclick = () => {
    mp.nx = clampInt(nxIn.value, 16, 512);
    mp.ny = clampInt(nyIn.value, 16, 512);
    mp.nz = clampInt(nzIn.value, 16, 512);
    mp.power = Number(powerIn.value) || 2;
    mp.maxDist = Number(maxDistIn.value) || 0;
    mp.maxPoints = clampInt(maxPointsIn.value, 0, 128);
    mp.sampleStep = Number(sampleStepIn.value) || 2;
    saveProject(project);

    if (!bounds) return;
    const samples = buildSamples(project);
    if (samples.length === 0) {
      resultBox.innerHTML = '';
      resultBox.append(h('div', { class: 'notice err' }, '没有可用的采样点。'));
      return;
    }

    const spacing: [number, number, number] = [
      (bounds.max[0] - bounds.min[0]) / (mp.nx - 1),
      (bounds.max[1] - bounds.min[1]) / (mp.ny - 1),
      (bounds.max[2] - bounds.min[2]) / (mp.nz - 1),
    ];

    runBtn.disabled = true;
    cancelBtn.disabled = false;
    progressText.textContent = '插值中… 0%';

    worker = new Worker(new URL('../idw.worker.ts', import.meta.url), { type: 'module' });
    const t0 = performance.now();
    worker.onmessage = async (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        const pct = Math.round((msg.done / msg.total) * 100);
        progressBar.style.width = `${pct}%`;
        progressText.textContent = `插值中… ${pct}% (${msg.done}/${msg.total} 层)`;
      } else if (msg.type === 'done') {
        cleanupWorker();
        const grades = new Float32Array(msg.buffer);
        let min = Infinity, max = -Infinity;
        for (let i = 0; i < grades.length; i++) {
          const g = grades[i];
          if (!Number.isFinite(g)) continue;
          if (g < min) min = g;
          if (g > max) max = g;
        }
        if (!Number.isFinite(min)) { min = 0; max = 1; }
        model = {
          nx: mp.nx, ny: mp.ny, nz: mp.nz,
          origin: [bounds.min[0], bounds.min[1], bounds.min[2]],
          spacing, min, max, grades,
        };
        await setCurrentModel(model);
        const dt = ((performance.now() - t0) / 1000).toFixed(1);
        progressText.textContent = `插值完成, 用时 ${dt} s, 模型已保存`;
        progressBar.style.width = '100%';
        runBtn.disabled = false;
        renderResult();
        renderReserves();
      }
    };
    worker.onerror = (err) => {
      cleanupWorker();
      runBtn.disabled = false;
      progressText.textContent = `插值失败: ${err.message}`;
    };
    const req: InterpRequest = {
      samples, nx: mp.nx, ny: mp.ny, nz: mp.nz,
      origin: [bounds.min[0], bounds.min[1], bounds.min[2]],
      spacing,
      params: { power: mp.power, maxDist: mp.maxDist, maxPoints: mp.maxPoints },
    };
    worker.postMessage(req, [samples.buffer]);
  };

  cancelBtn.onclick = () => {
    cleanupWorker();
    runBtn.disabled = false;
    progressText.textContent = '已取消';
  };

  function cleanupWorker(): void {
    worker?.terminate();
    worker = null;
    cancelBtn.disabled = true;
  }

  // ---- 插值结果 ----
  function renderResult(): void {
    resultBox.innerHTML = '';
    if (!model) return;
    const st = gridStats(model);
    const total = model.nx * model.ny * model.nz;
    resultBox.append(h('div', { class: 'card' },
      h('h3', {}, '模型统计'),
      h('div', { class: 'stat-grid' },
        stat('网格规模', `${model.nx}×${model.ny}×${model.nz}`),
        stat('最小品位', fmt(st.min, 4)),
        stat('最大品位', fmt(st.max, 4)),
        stat('平均品位', fmt(st.mean, 4)),
        stat('有效网格点', `${fmt(st.validCount, 0)} / ${fmt(total, 0)}`),
        stat('无数据点占比', `${fmt((st.nanCount / total) * 100, 1)}%`),
      ),
      h('p', { class: 'hint' }, '提示: 无数据点 (NaN) 在体渲染中显示为透明, 不参与储量计算。可增大搜索半径减少无数据区域。'),
    ));
  }

  // ---- 储量计算 ----
  function renderReserves(): void {
    reserveBox.innerHTML = '';
    if (!model) return;
    const m = model;

    const cutoffIn = numInput(project.cutoff, 0, 1e6, 0.05);
    const densityIn = numInput(project.density, 0.1, 20, 0.05);
    const unitSel = h('select', {});
    for (const u of ['%', 'g/t'] as const) {
      const o = h('option', { value: u }, u);
      if (project.gradeUnit === u) o.selected = true;
      unitSel.append(o);
    }
    const calcBtn = h('button', { class: 'primary' }, '计算');
    const reportBtn = h('button', {}, '导出储量报表 (CSV)');
    const outBox = h('div', {});

    function current() {
      project.cutoff = Number(cutoffIn.value) || 0;
      project.density = Number(densityIn.value) || 2.7;
      project.gradeUnit = unitSel.value as '%' | 'g/t';
      saveProject(project);
      return computeReserves(m.grades, m.spacing, project.cutoff, project.density, project.gradeUnit);
    }

    calcBtn.onclick = () => {
      const r = current();
      outBox.innerHTML = '';
      outBox.append(h('div', { class: 'stat-grid', style: 'margin-top:12px' },
        stat(`边界品位 ≥ ${fmt(r.cutoff, 3)} ${project.gradeUnit}`, ''),
        stat('矿体体积', `${fmt(r.volume, 0)} m³`),
        stat('矿石量', `${fmt(r.tonnage, 0)} t`),
        stat('平均品位', `${fmt(r.avgGrade, 4)} ${project.gradeUnit}`),
        stat('金属量', `${fmt(r.metal, 2)} ${r.metalUnit}`),
      ));
    };

    reportBtn.onclick = () => {
      current();
      // 报表: 从 0 到最大品位分 12 档
      const cutoffs: number[] = [];
      const step = m.max / 12;
      for (let i = 0; i <= 12; i++) cutoffs.push(Math.round(i * step * 1000) / 1000);
      const rows = sweepReserves(m.grades, m.spacing, cutoffs, project.density, project.gradeUnit);
      const header = `边界品位(${project.gradeUnit}),矿体体积(m3),矿石量(t),平均品位(${project.gradeUnit}),金属量(${rows[0]?.metalUnit ?? 't'})`;
      const body = rows.map((r) =>
        `${r.cutoff},${r.volume.toFixed(2)},${r.tonnage.toFixed(2)},${r.avgGrade.toFixed(5)},${r.metal.toFixed(3)}`);
      const meta = `# 项目: ${project.name}  网格: ${m.nx}x${m.ny}x${m.nz}  体重: ${project.density} t/m3  导出时间: ${new Date().toLocaleString('zh-CN')}`;
      downloadText(`储量报表_${project.name}.csv`, '﻿' + meta + '\n' + header + '\n' + body.join('\n'), 'text/csv');
    };

    reserveBox.append(h('div', { class: 'card' },
      h('h3', {}, '储量计算 (按边界品位)'),
      h('div', {},
        field('边界品位', cutoffIn),
        field('体重 (t/m³)', densityIn),
        field('品位单位', unitSel),
      ),
      h('div', { class: 'toolbar' }, calcBtn, reportBtn),
      outBox,
    ));
  }

  // 载入已有模型
  void getCurrentModel().then((m) => {
    if (m) {
      model = m;
      progressText.textContent = '已载入保存的模型';
      renderResult();
      renderReserves();
    }
  });

  return () => cleanupWorker();
}

function stat(k: string, v: string): HTMLElement {
  return h('div', { class: 'stat' }, h('div', { class: 'v' }, v || '—'), h('div', { class: 'k' }, k));
}

function numInput(value: number, min: number, max: number, step = 1): HTMLInputElement {
  const i = h('input', { type: 'number', value: String(value), min: String(min), max: String(max), step: String(step) });
  return i;
}

function field(label: string, input: HTMLElement): HTMLElement {
  return h('label', { class: 'field' }, label, input);
}

function clampInt(v: string, min: number, max: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

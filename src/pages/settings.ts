import { h } from '../ui';
import { clearAllData, getSettings, listProjects, saveSettings } from '../store';
import { rerender } from '../router';

export function renderSettingsPage(root: HTMLElement): void {
  root.append(h('h2', {}, '设置'));
  const s = getSettings();

  // ---- 渲染设置 ----
  const scaleSel = h('select', {});
  for (const v of ['0.5', '0.75', '1']) {
    const o = h('option', { value: v }, `${Number(v) * 100}%`);
    if (Math.abs(s.renderScale - Number(v)) < 0.01) o.selected = true;
    scaleSel.append(o);
  }
  const stepsIn = h('input', { type: 'number', value: String(s.raySteps), min: '64', max: '1024', step: '32' });
  const bgIn = h('input', { type: 'color', value: s.bgColor });

  root.append(h('div', { class: 'card' },
    h('h3', {}, '体渲染'),
    h('div', {},
      h('label', { class: 'field' }, '渲染分辨率比例', scaleSel),
      h('label', { class: 'field' }, '默认光线步进数', stepsIn),
      h('label', { class: 'field' }, '背景色', bgIn),
    ),
    h('p', { class: 'hint' }, '分辨率比例越低渲染越快; 256³ 网格建议 50%~75%。修改后进入体渲染页生效。'),
  ));

  // ---- 默认值 ----
  const densityIn = h('input', { type: 'number', value: String(s.defaultDensity), min: '0.1', max: '20', step: '0.05' });
  const unitSel = h('select', {});
  for (const u of ['%', 'g/t']) {
    const o = h('option', { value: u }, u);
    if (s.defaultUnit === u) o.selected = true;
    unitSel.append(o);
  }
  root.append(h('div', { class: 'card' },
    h('h3', {}, '新项目默认值'),
    h('div', {},
      h('label', { class: 'field' }, '默认体重 (t/m³)', densityIn),
      h('label', { class: 'field' }, '默认品位单位', unitSel),
    ),
  ));

  const saveBtn = h('button', { class: 'primary' }, '保存设置');
  const savedMsg = h('span', { class: 'ok' }, '');
  saveBtn.onclick = () => {
    saveSettings({
      renderScale: Number(scaleSel.value),
      raySteps: Math.max(64, Math.min(1024, Number(stepsIn.value) || 384)),
      bgColor: bgIn.value,
      defaultDensity: Number(densityIn.value) || 2.7,
      defaultUnit: unitSel.value === 'g/t' ? 'g/t' : '%',
    });
    savedMsg.textContent = ' 已保存';
    setTimeout(() => { savedMsg.textContent = ''; }, 2000);
  };
  root.append(h('div', { class: 'toolbar' }, saveBtn, savedMsg));

  // ---- 环境检测 ----
  const webgpuOk = typeof navigator !== 'undefined' && 'gpu' in navigator;
  root.append(h('div', { class: 'card' },
    h('h3', {}, '环境'),
    h('dl', { class: 'kv' },
      h('dt', {}, 'WebGPU'), h('dd', {}, webgpuOk ? '✓ 支持' : '✗ 不支持 (请使用 Chrome/Edge 113+)'),
      h('dt', {}, '项目数'), h('dd', {}, String(listProjects().length)),
      h('dt', {}, 'localStorage 占用'), h('dd', {}, `${(JSON.stringify(listProjects()).length / 1024).toFixed(1)} KB`),
    ),
  ));

  // ---- 危险区 ----
  const clearBtn = h('button', { class: 'danger' }, '清除全部数据 (项目 + 模型)');
  clearBtn.onclick = () => {
    if (confirm('确定清除全部项目、插值模型和设置? 不可恢复!')) {
      clearAllData();
      rerender();
    }
  };
  root.append(h('div', { class: 'card' },
    h('h3', {}, '危险操作'),
    clearBtn,
  ));
}

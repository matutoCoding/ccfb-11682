import { h, fmt, downloadText } from '../ui';
import { saveProject } from '../store';
import { getCurrentProject } from '../state';
import { ParseResult, crossCheck, parseAssays, parseCollars, parseSurveys } from '../csv';
import { Collar, Survey, Assay, Project } from '../types';
import { rerender } from '../router';

const FORMATS = {
  collar: '孔口表格式: 孔号, X, Y, Z[, 孔深] — 每行一条, 首行可为表头',
  survey: '测斜表格式: 孔号, 测深, 方位角(0~360), 倾角(-90~90, 向下为正)',
  assay: '品位表格式: 孔号, 自(m), 至(m), 品位',
};

const TEMPLATES = {
  collar: '孔号,X,Y,Z,孔深\nZK01,500000,3200400,200,200\nZK02,500100,3200400,201,200\n',
  survey: '孔号,测深,方位角,倾角\nZK01,0,0,90\nZK01,200,3,88\n',
  assay: '孔号,自,至,品位\nZK01,0,2,0.05\nZK01,2,4,0.42\n',
};

export function renderHolesPage(root: HTMLElement): void {
  const cur = getCurrentProject();
  root.append(h('h2', {}, '钻孔管理'));
  if (!cur) {
    root.append(h('div', { class: 'notice' }, '请先在右上角选择一个项目 (或到项目列表新建)。'));
    return;
  }
  const project = cur;

  root.append(h('p', { class: 'dim' },
    `当前项目: ${project.name} — 孔口 ${project.collars.length} 条, 测斜 ${project.surveys.length} 条, 品位 ${project.assays.length} 条。` +
    ' 坐标系: X 东 / Y 北 / Z 高程; 倾角向下为正。'));

  const resultBox = h('div', {});
  const overviewBox = h('div', {});

  // ---- 三个导入卡片 ----
  const cards = h('div', { class: 'row' });
  cards.append(
    importCard('孔口表 (Collar)', FORMATS.collar, TEMPLATES.collar,
      (text) => applyImport(project, 'collar', parseCollars(text), resultBox)),
    importCard('测斜表 (Survey)', FORMATS.survey, TEMPLATES.survey,
      (text) => applyImport(project, 'survey', parseSurveys(text), resultBox)),
    importCard('品位表 (Assay)', FORMATS.assay, TEMPLATES.assay,
      (text) => applyImport(project, 'assay', parseAssays(text), resultBox)),
  );
  root.append(cards);
  root.append(resultBox);
  root.append(overviewBox);

  renderOverview(project, overviewBox);

  function refresh(): void {
    saveProject(project);
    overviewBox.innerHTML = '';
    renderOverview(project, overviewBox);
  }

  function applyImport<T extends Collar | Survey | Assay>(
    p: Project,
    kind: 'collar' | 'survey' | 'assay',
    r: ParseResult<T>,
    box: HTMLElement,
  ): void {
    if (kind === 'collar') p.collars.push(...(r.rows as Collar[]));
    else if (kind === 'survey') p.surveys.push(...(r.rows as Survey[]));
    else p.assays.push(...(r.rows as Assay[]));
    saveProject(p);

    box.innerHTML = '';
    const kindName = kind === 'collar' ? '孔口表' : kind === 'survey' ? '测斜表' : '品位表';
    if (r.rows.length === 0 && r.errors.length === 0) {
      box.append(h('div', { class: 'notice' }, `${kindName}: 没有可导入的数据行。`));
      return;
    }
    const summary = h('div', { class: r.errors.length ? 'notice err' : 'notice' },
      `${kindName}: 成功导入 ${r.rows.length} 行` +
      (r.errors.length ? `, ${r.errors.length} 行格式错误 (见下表)` : '') +
      (r.headerSkipped ? ' (已自动跳过表头)' : ''));
    if (!r.errors.length) {
      summary.style.borderColor = 'var(--ok)';
      summary.style.color = 'var(--ok)';
    }
    box.append(summary);

    if (r.errors.length) {
      const t = h('table', { class: 'grid' });
      t.append(h('tr', {}, h('th', {}, '行号'), h('th', {}, '内容'), h('th', {}, '错误原因')));
      for (const e of r.errors.slice(0, 200)) {
        t.append(h('tr', {},
          h('td', { class: 'num' }, String(e.line)),
          h('td', { class: 'mono' }, e.content),
          h('td', { class: 'err' }, e.reason),
        ));
      }
      box.append(h('div', { class: 'err-table' }, t));
      if (r.errors.length > 200) box.append(h('p', { class: 'dim' }, `…仅显示前 200 条错误, 共 ${r.errors.length} 条`));
    }

    const warnings = crossCheck(p.collars, p.surveys, p.assays);
    if (warnings.length) {
      box.append(h('div', { class: 'notice' }, ...warnings.map((w) => h('div', {}, `⚠ ${w}`))));
    }
    refresh();
  }
}

function importCard(
  title: string,
  formatHint: string,
  template: string,
  onImport: (text: string) => void,
): HTMLElement {
  const ta = h('textarea', { placeholder: '粘贴 CSV 内容, 或选择文件…' });
  const file = h('input', { type: 'file', accept: '.csv,.txt,text/csv', style: 'display:none' });
  file.onchange = async () => {
    const f = file.files?.[0];
    if (f) ta.value = await f.text();
  };
  const importBtn = h('button', { class: 'primary' }, '导入 (追加)');
  importBtn.onclick = () => {
    if (ta.value.trim()) onImport(ta.value);
  };
  const fileBtn = h('button', {}, '选择 CSV 文件');
  fileBtn.onclick = () => file.click();
  const tplBtn = h('button', {}, '下载模板');
  tplBtn.onclick = () => downloadText(`${title.split(' ')[0]}_模板.csv`, template, 'text/csv');

  return h('div', { class: 'card grow', style: 'min-width:320px' },
    h('h3', {}, title),
    h('p', { class: 'hint' }, formatHint),
    ta,
    h('div', { class: 'toolbar', style: 'margin-top:8px;margin-bottom:0' }, importBtn, fileBtn, tplBtn, file),
  );
}

function renderOverview(project: Project, box: HTMLElement): void {
  if (project.collars.length === 0) return;

  const surveyCount = new Map<string, number>();
  for (const s of project.surveys) surveyCount.set(s.holeId, (surveyCount.get(s.holeId) ?? 0) + 1);
  const assayStats = new Map<string, { n: number; len: number; sum: number }>();
  for (const a of project.assays) {
    let st = assayStats.get(a.holeId);
    if (!st) { st = { n: 0, len: 0, sum: 0 }; assayStats.set(a.holeId, st); }
    st.n++;
    st.len += a.to - a.from;
    st.sum += a.grade * (a.to - a.from);
  }

  const t = h('table', { class: 'grid' });
  t.append(h('tr', {},
    h('th', {}, '孔号'), h('th', {}, 'X'), h('th', {}, 'Y'), h('th', {}, 'Z'),
    h('th', {}, '孔深(m)'), h('th', {}, '测斜点'), h('th', {}, '品位段'),
    h('th', {}, '加权平均品位'), h('th', {}, ''),
  ));
  for (const c of project.collars) {
    const st = assayStats.get(c.holeId);
    const avg = st && st.len > 0 ? st.sum / st.len : NaN;
    const delBtn = h('button', { class: 'danger' }, '删除该孔');
    delBtn.onclick = () => {
      if (!confirm(`删除钻孔 ${c.holeId} 及其全部测斜/品位数据?`)) return;
      project.collars = project.collars.filter((x) => x.holeId !== c.holeId);
      project.surveys = project.surveys.filter((x) => x.holeId !== c.holeId);
      project.assays = project.assays.filter((x) => x.holeId !== c.holeId);
      saveProject(project);
      rerender();
    };
    t.append(h('tr', {},
      h('td', {}, c.holeId),
      h('td', { class: 'num' }, fmt(c.x, 2)),
      h('td', { class: 'num' }, fmt(c.y, 2)),
      h('td', { class: 'num' }, fmt(c.z, 2)),
      h('td', { class: 'num' }, fmt(c.maxDepth, 1)),
      h('td', { class: 'num' }, String(surveyCount.get(c.holeId) ?? 0)),
      h('td', { class: 'num' }, String(st?.n ?? 0)),
      h('td', { class: 'num' }, Number.isFinite(avg) ? fmt(avg, 3) : '—'),
      h('td', {}, delBtn),
    ));
  }

  const clearBtn = h('button', { class: 'danger' }, '清空全部钻孔数据');
  clearBtn.onclick = () => {
    if (!confirm('清空该项目的全部孔口/测斜/品位数据?')) return;
    project.collars = [];
    project.surveys = [];
    project.assays = [];
    saveProject(project);
    rerender();
  };

  box.append(h('div', { class: 'card' },
    h('h3', {}, `钻孔一览 (${project.collars.length} 个孔)`),
    h('div', { style: 'overflow:auto' }, t),
    h('div', { class: 'toolbar', style: 'margin-top:10px;margin-bottom:0' }, clearBtn),
  ));
}

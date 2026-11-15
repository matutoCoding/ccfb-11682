import { h, fmt, downloadText } from '../ui';
import {
  listProjects, createProject, deleteProject, duplicateProject,
  exportProjects, importProjects, saveProject,
} from '../store';
import { setCurrentProjectId } from '../state';
import { createDemoProject } from '../demo';
import { rerender } from '../router';

export function renderProjectsPage(root: HTMLElement): void {
  root.append(h('h2', {}, '项目列表'));

  // 工具栏
  const nameInput = h('input', { type: 'text', placeholder: '新项目名称', style: 'width:200px' });
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  const toolbar = h('div', { class: 'toolbar' },
    nameInput,
    (() => {
      const b = h('button', { class: 'primary' }, '新建项目');
      b.onclick = () => {
        const p = createProject(nameInput.value.trim() || '未命名项目');
        setCurrentProjectId(p.id);
        rerender();
      };
      return b;
    })(),
    (() => {
      const b = h('button', {}, '生成演示项目');
      b.title = '生成一个透镜状矿体的演示数据, 用于快速体验';
      b.onclick = () => {
        const p = createDemoProject();
        setCurrentProjectId(p.id);
        rerender();
      };
      return b;
    })(),
    (() => {
      const b = h('button', {}, '导入项目 (JSON)');
      b.onclick = () => fileInput.click();
      return b;
    })(),
    (() => {
      const b = h('button', {}, '导出全部项目');
      b.onclick = () => downloadText(`钻孔项目_${new Date().toISOString().slice(0, 10)}.json`, exportProjects(), 'application/json');
      return b;
    })(),
    fileInput,
  );
  root.append(toolbar);

  const msgBox = h('div', {});
  root.append(msgBox);

  fileInput.onchange = async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const text = await f.text();
    const r = importProjects(text);
    msgBox.innerHTML = '';
    if (r.errors.length) {
      msgBox.append(h('div', { class: 'notice err' }, `导入完成, ${r.errors.length} 条问题: ${r.errors.join('; ')}`));
    } else {
      msgBox.append(h('div', { class: 'notice', style: 'border-color:var(--ok);color:var(--ok)' }, `成功导入 ${r.added} 个项目`));
    }
    rerender();
  };

  // 项目表格
  const projects = listProjects();
  if (projects.length === 0) {
    root.append(h('div', { class: 'notice' }, '还没有项目。新建一个, 或点击「生成演示项目」快速体验。'));
    return;
  }

  const table = h('table', { class: 'grid' });
  table.append(h('tr', {},
    h('th', {}, '名称'), h('th', {}, '备注'), h('th', {}, '钻孔数'), h('th', {}, '测斜点数'),
    h('th', {}, '品位段数'), h('th', {}, '更新时间'), h('th', {}, '操作'),
  ));
  for (const p of projects) {
    const nameCell = h('td', {});
    const nameEdit = h('input', { type: 'text', value: p.name, style: 'width:160px' });
    nameEdit.onchange = () => {
      p.name = nameEdit.value.trim() || p.name;
      saveProject(p);
      rerender();
    };
    nameCell.append(nameEdit);

    const openBtn = h('button', { class: 'primary' }, '打开');
    openBtn.onclick = () => {
      setCurrentProjectId(p.id);
      location.hash = '#/holes';
    };
    const dupBtn = h('button', {}, '复制');
    dupBtn.onclick = () => { duplicateProject(p.id); rerender(); };
    const expBtn = h('button', {}, '导出');
    expBtn.onclick = () => downloadText(`${p.name}.json`, exportProjects([p.id]), 'application/json');
    const delBtn = h('button', { class: 'danger' }, '删除');
    delBtn.onclick = () => {
      if (confirm(`确定删除项目「${p.name}」? 数据不可恢复。`)) {
        deleteProject(p.id);
        rerender();
      }
    };

    table.append(h('tr', {},
      nameCell,
      h('td', { class: 'dim' }, p.note || '—'),
      h('td', { class: 'num' }, String(p.collars.length)),
      h('td', { class: 'num' }, String(p.surveys.length)),
      h('td', { class: 'num' }, String(p.assays.length)),
      h('td', { class: 'dim' }, new Date(p.updatedAt).toLocaleString('zh-CN')),
      h('td', {}, openBtn, ' ', dupBtn, ' ', expBtn, ' ', delBtn),
    ));
  }
  root.append(h('div', { class: 'card' }, table));
  root.append(h('p', { class: 'hint' },
    `共 ${projects.length} 个项目。项目数据保存在浏览器 localStorage 中; 插值网格保存在 IndexedDB。` +
    ` 存储占用约 ${fmt(JSON.stringify(projects).length / 1024, 0)} KB。`));
}

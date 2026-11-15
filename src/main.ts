import './style.css';
import { h } from './ui';
import { listProjects } from './store';
import { getCurrentProjectId, setCurrentProjectId, onCurrentProjectChange } from './state';
import { routeTitles, rerender, setAfterRender, startRouter, currentRouteName } from './router';

function buildNav(): void {
  const nav = document.getElementById('nav')!;
  nav.innerHTML = '';
  nav.append(h('span', { class: 'brand' }, '钻孔三维体渲染'));
  const route = currentRouteName();
  for (const [name, title] of Object.entries(routeTitles)) {
    const a = h('a', { href: `#/${name}` }, title);
    if (name === route) a.classList.add('active');
    nav.append(a);
  }
  nav.append(h('span', { class: 'spacer' }));

  const sel = h('select', { title: '当前项目' });
  sel.append(h('option', { value: '' }, '— 选择项目 —'));
  for (const p of listProjects()) {
    const o = h('option', { value: p.id }, p.name);
    if (p.id === getCurrentProjectId()) o.selected = true;
    sel.append(o);
  }
  sel.onchange = () => setCurrentProjectId(sel.value);
  nav.append(sel);
}

setAfterRender(buildNav);
onCurrentProjectChange(() => rerender());
startRouter();

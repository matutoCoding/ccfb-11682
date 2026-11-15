import { renderProjectsPage } from './pages/projects';
import { renderHolesPage } from './pages/holes';
import { renderModelingPage } from './pages/modeling';
import { renderVolumePage } from './pages/volume';
import { renderSectionPage } from './pages/section';
import { renderSettingsPage } from './pages/settings';

export type PageFn = (root: HTMLElement) => void | (() => void);

const routes: Record<string, PageFn> = {
  projects: renderProjectsPage,
  holes: renderHolesPage,
  modeling: renderModelingPage,
  volume: renderVolumePage,
  section: renderSectionPage,
  settings: renderSettingsPage,
};

export const routeTitles: Record<string, string> = {
  projects: '项目列表',
  holes: '钻孔管理',
  modeling: '插值建模',
  volume: '体渲染',
  section: '剖面分析',
  settings: '设置',
};

let cleanup: (() => void) | null = null;
let afterRender: (() => void) | null = null;

export function currentRouteName(): string {
  const name = location.hash.replace(/^#\/?/, '').split('?')[0];
  return routes[name] ? name : 'projects';
}

export function setAfterRender(cb: () => void): void {
  afterRender = cb;
}

function render(): void {
  cleanup?.();
  cleanup = null;
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  const name = currentRouteName();
  app.classList.toggle('full', name === 'volume');
  const c = routes[name](app);
  if (typeof c === 'function') cleanup = c;
  afterRender?.();
}

export function rerender(): void {
  render();
}

export function startRouter(): void {
  window.addEventListener('hashchange', render);
  if (!location.hash) location.hash = '#/projects';
  render();
}

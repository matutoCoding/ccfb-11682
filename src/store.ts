import { GridModel, Project, defaultModelParams } from './types';
import { defaultTF } from './transfer';
import { uid } from './ui';

const LS_KEY = 'borehole3d.projects.v1';
const SETTINGS_KEY = 'borehole3d.settings.v1';

let cache: Project[] | null = null;

function load(): Project[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persist(): void {
  localStorage.setItem(LS_KEY, JSON.stringify(cache ?? []));
}

export function listProjects(): Project[] {
  cache ??= load();
  return cache;
}

export function getProject(id: string): Project | null {
  return listProjects().find((p) => p.id === id) ?? null;
}

export function createProject(name: string): Project {
  const now = Date.now();
  const p: Project = {
    id: uid(),
    name: name || '未命名项目',
    note: '',
    createdAt: now,
    updatedAt: now,
    collars: [],
    surveys: [],
    assays: [],
    modelParams: defaultModelParams(),
    tf: defaultTF(),
    cutoff: 0.3,
    density: 2.7,
    gradeUnit: '%',
  };
  listProjects().push(p);
  persist();
  return p;
}

export function saveProject(p: Project): void {
  p.updatedAt = Date.now();
  persist();
}

export function deleteProject(id: string): void {
  cache = listProjects().filter((p) => p.id !== id);
  persist();
  void deleteGridModel(id);
}

export function duplicateProject(id: string): Project | null {
  const src = getProject(id);
  if (!src) return null;
  const copy: Project = JSON.parse(JSON.stringify(src));
  copy.id = uid();
  copy.name = src.name + ' (副本)';
  copy.createdAt = Date.now();
  copy.updatedAt = Date.now();
  listProjects().push(copy);
  persist();
  // 复制网格模型
  void loadGridModel(id).then((m) => {
    if (m) void saveGridModel(copy.id, m);
  });
  return copy;
}

// ---------- 导入 / 导出 ----------

export function exportProjects(ids?: string[]): string {
  const all = listProjects();
  const sel = ids ? all.filter((p) => ids.includes(p.id)) : all;
  return JSON.stringify({ app: 'borehole3d', version: 1, projects: sel }, null, 2);
}

export function importProjects(text: string): { added: number; errors: string[] } {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { added: 0, errors: [`JSON 解析失败: ${(e as Error).message}`] };
  }
  const obj = parsed as { projects?: unknown };
  if (!obj || !Array.isArray(obj.projects)) {
    return { added: 0, errors: ['文件格式不正确: 缺少 projects 数组'] };
  }
  const existing = new Set(listProjects().map((p) => p.id));
  let added = 0;
  obj.projects.forEach((raw, i) => {
    const p = raw as Partial<Project>;
    if (!p || typeof p.name !== 'string' || !Array.isArray(p.collars) || !Array.isArray(p.surveys) || !Array.isArray(p.assays)) {
      errors.push(`第 ${i + 1} 个项目缺少必要字段, 已跳过`);
      return;
    }
    const proj: Project = {
      id: typeof p.id === 'string' && !existing.has(p.id) ? p.id : uid(),
      name: p.name,
      note: typeof p.note === 'string' ? p.note : '',
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
      updatedAt: Date.now(),
      collars: p.collars,
      surveys: p.surveys,
      assays: p.assays,
      modelParams: { ...defaultModelParams(), ...(p.modelParams ?? {}) },
      tf: Array.isArray(p.tf) && p.tf.length >= 2 ? p.tf : defaultTF(),
      cutoff: typeof p.cutoff === 'number' ? p.cutoff : 0.3,
      density: typeof p.density === 'number' ? p.density : 2.7,
      gradeUnit: p.gradeUnit === 'g/t' ? 'g/t' : '%',
    };
    existing.add(proj.id);
    listProjects().push(proj);
    added++;
  });
  persist();
  return { added, errors };
}

// ---------- 全局设置 ----------

export interface AppSettings {
  renderScale: number;   // 体渲染分辨率比例 0.5~1
  raySteps: number;      // 光线步进数
  bgColor: string;       // 渲染背景色
  defaultDensity: number;
  defaultUnit: '%' | 'g/t';
}

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { renderScale: 0.75, raySteps: 384, bgColor: '#0d1117', defaultDensity: 2.7, defaultUnit: '%', ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { renderScale: 0.75, raySteps: 384, bgColor: '#0d1117', defaultDensity: 2.7, defaultUnit: '%' };
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function clearAllData(): void {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem('borehole3d.current');
  cache = null;
  void deleteGridDB();
}

// ---------- 网格模型持久化 (IndexedDB, 网格体积大, 不放 localStorage) ----------

const DB_NAME = 'borehole3d';
const STORE = 'grids';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

interface StoredGrid {
  nx: number; ny: number; nz: number;
  origin: [number, number, number];
  spacing: [number, number, number];
  min: number; max: number;
  buffer: ArrayBuffer;
}

export async function saveGridModel(projectId: string, m: GridModel): Promise<void> {
  const db = await openDB();
  const rec: StoredGrid = {
    nx: m.nx, ny: m.ny, nz: m.nz,
    origin: m.origin, spacing: m.spacing,
    min: m.min, max: m.max,
    buffer: m.grades.buffer.slice(0) as ArrayBuffer,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec, projectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadGridModel(projectId: string): Promise<GridModel | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(projectId);
      req.onsuccess = () => {
        const rec = req.result as StoredGrid | undefined;
        if (!rec) return resolve(null);
        resolve({
          nx: rec.nx, ny: rec.ny, nz: rec.nz,
          origin: rec.origin, spacing: rec.spacing,
          min: rec.min, max: rec.max,
          grades: new Float32Array(rec.buffer),
        });
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteGridModel(projectId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

function deleteGridDB(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

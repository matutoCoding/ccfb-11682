import { GridModel, Project } from './types';
import { getProject, loadGridModel, saveGridModel } from './store';

const CURRENT_KEY = 'borehole3d.current';

let currentId: string = localStorage.getItem(CURRENT_KEY) ?? '';
let modelCache: { projectId: string; model: GridModel } | null = null;
const listeners = new Set<() => void>();

export function getCurrentProjectId(): string {
  return currentId;
}

export function getCurrentProject(): Project | null {
  return currentId ? getProject(currentId) : null;
}

export function setCurrentProjectId(id: string): void {
  if (id === currentId) return;
  currentId = id;
  localStorage.setItem(CURRENT_KEY, id);
  listeners.forEach((f) => f());
}

export function onCurrentProjectChange(f: () => void): void {
  listeners.add(f);
}

/** 取当前项目的网格模型 (内存缓存 -> IndexedDB) */
export async function getCurrentModel(): Promise<GridModel | null> {
  if (!currentId) return null;
  if (modelCache && modelCache.projectId === currentId) return modelCache.model;
  const m = await loadGridModel(currentId);
  if (m) modelCache = { projectId: currentId, model: m };
  return m;
}

/** 更新当前项目的网格模型 (写内存 + IndexedDB) */
export async function setCurrentModel(model: GridModel): Promise<void> {
  if (!currentId) return;
  modelCache = { projectId: currentId, model };
  await saveGridModel(currentId, model);
}

export function clearModelCache(): void {
  modelCache = null;
}

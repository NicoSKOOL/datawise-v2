import {
  generateKnowledgeBaseDrafts,
  type KBAutoDraftResponse,
} from './content-writer';

export type KBAutoDraftTaskStatus = 'idle' | 'running' | 'success' | 'error';

export interface KBAutoDraftTaskState {
  key: string;
  workspaceId: string;
  websiteUrl: string;
  status: KBAutoDraftTaskStatus;
  startedAt?: number;
  completedAt?: number;
  response?: KBAutoDraftResponse;
  error?: string;
}

type Listener = () => void;

const tasks = new Map<string, KBAutoDraftTaskState>();
const listeners = new Set<Listener>();

function normalizeTaskUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

export function kbAutoDraftTaskKey(workspaceId: string, websiteUrl: string): string {
  return `${workspaceId}::${normalizeTaskUrl(websiteUrl).toLowerCase()}`;
}

export function getKBAutoDraftTask(workspaceId: string, websiteUrl: string): KBAutoDraftTaskState {
  const normalizedUrl = normalizeTaskUrl(websiteUrl);
  const key = kbAutoDraftTaskKey(workspaceId, normalizedUrl);
  return tasks.get(key) || {
    key,
    workspaceId,
    websiteUrl: normalizedUrl,
    status: 'idle',
  };
}

export function getLatestKBAutoDraftTaskForWorkspace(workspaceId: string): KBAutoDraftTaskState | null {
  const matches = [...tasks.values()].filter((task) => task.workspaceId === workspaceId);
  return matches.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0] || null;
}

export function subscribeKBAutoDraftTasks(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

export function startKBAutoDraftTask(workspaceId: string, websiteUrl: string): KBAutoDraftTaskState {
  const normalizedUrl = normalizeTaskUrl(websiteUrl);
  const key = kbAutoDraftTaskKey(workspaceId, normalizedUrl);
  const existing = tasks.get(key);
  if (existing?.status === 'running') return existing;

  const running: KBAutoDraftTaskState = {
    key,
    workspaceId,
    websiteUrl: normalizedUrl,
    status: 'running',
    startedAt: Date.now(),
  };
  tasks.set(key, running);
  notifyListeners();

  void generateKnowledgeBaseDrafts(workspaceId, normalizedUrl)
    .then((response) => {
      tasks.set(key, {
        ...running,
        status: 'success',
        response,
        completedAt: Date.now(),
      });
      notifyListeners();
    })
    .catch((error) => {
      tasks.set(key, {
        ...running,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        completedAt: Date.now(),
      });
      notifyListeners();
    });

  return running;
}

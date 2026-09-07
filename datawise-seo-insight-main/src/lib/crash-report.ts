// Render-crash capture. Both error boundaries call recordCrash(); the record is
// kept in sessionStorage so the feedback bubble can attach it to a report
// filed afterwards, and posted to the worker so a crash nobody reports still
// shows up in the admin activity log. Two crash reports (Aug 28, Sep 7 2026)
// arrived with no stack at all because the boundary only printed it on screen.

import { api } from './api';

export interface CrashRecord {
  name: string;
  message: string;
  stack?: string;
  component_stack?: string;
  route: string;
  source: string;
  at: string;
}

const STORAGE_KEY = 'dw_last_crash';
const MAX_AGE_MS = 15 * 60 * 1000;
const LIMITS = { message: 500, stack: 4000, component_stack: 3000, route: 300 } as const;

function clip(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

export function buildCrashRecord(
  error: unknown,
  info?: { componentStack?: string | null } | null,
  source = 'app',
  route = typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '',
  now: Date = new Date(),
): CrashRecord {
  const err = error instanceof Error ? error : null;
  return {
    name: clip(err?.name, 100) || 'Error',
    message: clip(err ? err.message : String(error), LIMITS.message) || '(no message)',
    stack: clip(err?.stack, LIMITS.stack),
    component_stack: clip(info?.componentStack, LIMITS.component_stack),
    route: clip(route, LIMITS.route) || '',
    source,
    at: now.toISOString(),
  };
}

export function storeCrash(record: CrashRecord, storage: Pick<Storage, 'setItem'> | null = safeSessionStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage can be unavailable (private mode, quota); the record is best-effort.
  }
}

export function getRecentCrash(
  nowMs: number = Date.now(),
  storage: Pick<Storage, 'getItem'> | null = safeSessionStorage(),
): CrashRecord | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CrashRecord>;
    if (!parsed || typeof parsed.at !== 'string' || typeof parsed.message !== 'string') return null;
    const age = nowMs - Date.parse(parsed.at);
    if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;
    return parsed as CrashRecord;
  } catch {
    return null;
  }
}

export function formatCrashForFeedback(crash: CrashRecord): string {
  const lines = [
    `--- last crash (auto-attached, ${crash.at}) ---`,
    `route: ${crash.route}`,
    `source: ${crash.source}`,
    `${crash.name}: ${crash.message}`,
  ];
  if (crash.stack) lines.push('', crash.stack);
  if (crash.component_stack) lines.push('', '--- component stack ---', crash.component_stack);
  return lines.join('\n');
}

// Appends the most recent crash (if any) to the feedback bubble's browser_info
// so the report carries the stack the user never pastes by hand.
export function withRecentCrash(browserInfo: string, nowMs: number = Date.now()): string {
  const crash = getRecentCrash(nowMs);
  return crash ? `${browserInfo}\n\n${formatCrashForFeedback(crash)}` : browserInfo;
}

export function recordCrash(error: unknown, info?: { componentStack?: string | null } | null, source = 'app'): CrashRecord {
  const record = buildCrashRecord(error, info, source);
  storeCrash(record);
  void api('/api/client-crash', { method: 'POST', body: record }).catch(() => {
    // Never let telemetry throw inside an error boundary.
  });
  return record;
}

function safeSessionStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

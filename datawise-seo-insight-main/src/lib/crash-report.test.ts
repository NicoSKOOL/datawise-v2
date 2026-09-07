import { describe, it, expect } from 'vitest';
import {
  buildCrashRecord,
  formatCrashForFeedback,
  getRecentCrash,
  storeCrash,
  withRecentCrash,
} from './crash-report';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

describe('buildCrashRecord', () => {
  it('captures name, message, stacks, route and bounds long fields', () => {
    const error = new TypeError("Cannot read properties of undefined (reading 'map')");
    error.stack = 'x'.repeat(5000);
    const record = buildCrashRecord(error, { componentStack: 'c'.repeat(4000) }, 'route', '/content-tools?tab=optimizer', new Date('2026-09-07T01:11:30Z'));
    expect(record.name).toBe('TypeError');
    expect(record.message).toContain("reading 'map'");
    expect(record.stack).toHaveLength(4001);
    expect(record.component_stack).toHaveLength(3001);
    expect(record.route).toBe('/content-tools?tab=optimizer');
    expect(record.source).toBe('route');
    expect(record.at).toBe('2026-09-07T01:11:30.000Z');
  });

  it('copes with non-Error throwables', () => {
    const record = buildCrashRecord('plain string', null, 'app', '/x');
    expect(record).toMatchObject({ name: 'Error', message: 'plain string', route: '/x' });
    expect(record.stack).toBeUndefined();
  });
});

describe('getRecentCrash', () => {
  it('returns a crash stored within the last 15 minutes and drops older ones', () => {
    const storage = memoryStorage();
    const record = buildCrashRecord(new Error('boom'), null, 'app', '/r', new Date('2026-09-07T01:00:00Z'));
    storeCrash(record, storage);
    expect(getRecentCrash(Date.parse('2026-09-07T01:10:00Z'), storage)?.message).toBe('boom');
    expect(getRecentCrash(Date.parse('2026-09-07T01:20:00Z'), storage)).toBeNull();
  });

  it('ignores missing or corrupt storage values', () => {
    const storage = memoryStorage();
    expect(getRecentCrash(Date.now(), storage)).toBeNull();
    storage.setItem('dw_last_crash', '{not json');
    expect(getRecentCrash(Date.now(), storage)).toBeNull();
    expect(getRecentCrash(Date.now(), null)).toBeNull();
  });
});

describe('formatCrashForFeedback / withRecentCrash', () => {
  it('renders a readable block with both stacks', () => {
    const record = buildCrashRecord(new Error('boom'), { componentStack: '\n  at Foo' }, 'route', '/r', new Date('2026-09-07T01:00:00Z'));
    const text = formatCrashForFeedback(record);
    expect(text).toContain('--- last crash (auto-attached, 2026-09-07T01:00:00.000Z) ---');
    expect(text).toContain('route: /r');
    expect(text).toContain('Error: boom');
    expect(text).toContain('--- component stack ---');
    expect(text).not.toContain('—');
  });

  it('leaves browser_info untouched when there is no recent crash', () => {
    expect(withRecentCrash('UA', Date.now())).toBe('UA');
  });
});

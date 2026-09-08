import { describe, it, expect, beforeEach } from 'vitest';
import { setReturnTo, consumeReturnTo, RETURN_TO_KEY } from '@/lib/return-to';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  } as Storage;
}

describe('return-to', () => {
  beforeEach(() => { (globalThis as any).sessionStorage = memoryStorage(); });

  it('stores an app-relative path and hands it back once', () => {
    setReturnTo('/connect?req=abc');
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/connect?req=abc');
    expect(consumeReturnTo()).toBe('/connect?req=abc');
    expect(consumeReturnTo()).toBeNull();
  });

  it('ignores absolute and protocol-relative targets', () => {
    setReturnTo('https://evil.test/x');
    expect(consumeReturnTo()).toBeNull();
    setReturnTo('//evil.test/x');
    expect(consumeReturnTo()).toBeNull();
  });

  it('survives a missing sessionStorage', () => {
    (globalThis as any).sessionStorage = undefined;
    expect(() => setReturnTo('/x')).not.toThrow();
    expect(consumeReturnTo()).toBeNull();
  });

  it('survives a sessionStorage whose calls throw', () => {
    (globalThis as any).sessionStorage = {
      getItem: () => { throw new Error('boom'); },
      setItem: () => { throw new Error('boom'); },
      removeItem: () => { throw new Error('boom'); },
      clear: () => { throw new Error('boom'); },
      key: () => { throw new Error('boom'); },
      length: 0,
    } as Storage;
    expect(() => setReturnTo('/x')).not.toThrow();
    expect(consumeReturnTo()).toBeNull();
  });
});

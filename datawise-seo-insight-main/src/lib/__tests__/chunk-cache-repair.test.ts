import { describe, it, expect, vi } from 'vitest';
import {
  isChunkLoadError,
  extractModuleUrl,
  parseChunkDeps,
  repairAssetCache,
} from '../chunk-cache-repair';

const CHROME_MESSAGE =
  'Failed to fetch dynamically imported module: https://datawiseseo.com/assets/ContentTools-CMe_DPIB.js';

describe('isChunkLoadError', () => {
  it('matches the Chrome dynamic-import failure', () => {
    expect(isChunkLoadError(new TypeError(CHROME_MESSAGE))).toBe(true);
  });

  it('matches Safari and Firefox wording', () => {
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(
      isChunkLoadError(new TypeError('error loading dynamically imported module: /assets/x.js')),
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError('not an error')).toBe(false);
  });
});

describe('extractModuleUrl', () => {
  it('pulls the module URL out of the error message', () => {
    expect(extractModuleUrl(CHROME_MESSAGE)).toBe(
      'https://datawiseseo.com/assets/ContentTools-CMe_DPIB.js',
    );
  });

  it('returns null when the message carries no URL', () => {
    expect(extractModuleUrl('Importing a module script failed.')).toBeNull();
  });
});

describe('parseChunkDeps', () => {
  const base = 'https://datawiseseo.com/assets/ContentTools-CMe_DPIB.js';

  it('resolves relative static and dynamic import specifiers', () => {
    const source = [
      'import{C as a}from"./copy-Bo6QSxuL.js";',
      "import{b}from'./badge-BuGlOgIT.js';",
      'const p=()=>import("./ExportMenu-Ctyq7zAP.js");',
      'export{a,b};',
    ].join('\n');

    expect(parseChunkDeps(source, base)).toEqual([
      'https://datawiseseo.com/assets/copy-Bo6QSxuL.js',
      'https://datawiseseo.com/assets/badge-BuGlOgIT.js',
      'https://datawiseseo.com/assets/ExportMenu-Ctyq7zAP.js',
    ]);
  });

  it('de-duplicates repeated specifiers', () => {
    const source = 'import"./copy-Bo6QSxuL.js";import{C}from"./copy-Bo6QSxuL.js";';
    expect(parseChunkDeps(source, base)).toHaveLength(1);
  });

  it('returns nothing for an HTML body (the poisoned SPA fallback)', () => {
    const html = '<!doctype html><html><head><script src="/assets/index-CuplH0l-.js"></script>';
    expect(parseChunkDeps(html, base)).toEqual([]);
  });
});

describe('repairAssetCache', () => {
  const A = 'https://datawiseseo.com/assets/A.js';
  const B = 'https://datawiseseo.com/assets/B.js';
  const C = 'https://datawiseseo.com/assets/C.js';

  function fakeFetch(graph: Record<string, string>) {
    return vi.fn(async (url: string) => ({
      text: async () => graph[url] ?? '',
    })) as unknown as typeof fetch;
  }

  it('refetches the whole import graph bypassing the HTTP cache', async () => {
    const fetchSpy = fakeFetch({
      [A]: 'import"./B.js";',
      [B]: 'import"./C.js";',
      [C]: 'export default 1;',
    });

    const repaired = await repairAssetCache(A, { fetchImpl: fetchSpy });

    expect(repaired).toEqual([A, B, C]);
    for (const [url, init] of (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls) {
      expect(url).toMatch(/\/assets\//);
      expect((init as RequestInit).cache).toBe('reload');
    }
  });

  it('visits each URL once even when the graph has cycles', async () => {
    const fetchSpy = fakeFetch({ [A]: 'import"./B.js";', [B]: 'import"./A.js";' });
    const repaired = await repairAssetCache(A, { fetchImpl: fetchSpy });
    expect(repaired).toEqual([A, B]);
  });

  it('stops at maxFiles so a huge graph cannot stall the reload', async () => {
    const fetchSpy = fakeFetch({
      [A]: 'import"./B.js";import"./C.js";',
      [B]: '',
      [C]: '',
    });
    const repaired = await repairAssetCache(A, { fetchImpl: fetchSpy, maxFiles: 2 });
    expect(repaired).toEqual([A, B]);
  });

  it('keeps going when one asset fails to refetch', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url === B) throw new TypeError('network down');
      return { text: async () => (url === A ? 'import"./B.js";import"./C.js";' : '') };
    }) as unknown as typeof fetch;

    const repaired = await repairAssetCache(A, { fetchImpl: fetchSpy });
    expect(repaired).toEqual([A, C]);
  });
});

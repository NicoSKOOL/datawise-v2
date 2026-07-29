/**
 * Recovery for lazy-route chunks that fail to import after a deploy.
 *
 * Cloudflare Pages answers an unknown `/assets/*` path with the SPA fallback:
 * HTTP 200, `content-type: text/html`, `cache-control: public, max-age=14400`.
 * If a browser asks for a chunk during the window where the deployment it
 * belongs to is not the one being served, it caches that HTML for four hours.
 * From then on `import()` of that URL fails with "Failed to fetch dynamically
 * imported module" even though the file is live and serves valid JavaScript,
 * and a normal reload re-reads the same poisoned cache entry.
 *
 * `fetch(url, { cache: 'reload' })` goes to the network and overwrites the
 * cache entry, so refetching the failing module's import graph and then
 * reloading recovers the page. The failure is only visible on the top-level
 * module (the browser reports that URL even when a nested dependency is the
 * one that failed), which is why we walk the graph instead of refetching a
 * single file.
 */

const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i;

const MODULE_URL_RE = /https?:\/\/[^\s"')]+\.js/;

/** `from"./x.js"`, `import"./x.js"`, `import("./x.js")` in built output. */
const RELATIVE_SPECIFIER_RE = /["'](\.\.?\/[A-Za-z0-9_.$-]+\.js)["']/g;

const DEFAULT_MAX_FILES = 80;

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_ERROR_RE.test(`${error.name}: ${error.message}`);
}

export function extractModuleUrl(message: string): string | null {
  return message.match(MODULE_URL_RE)?.[0] ?? null;
}

export function parseChunkDeps(source: string, baseUrl: string): string[] {
  const deps = new Set<string>();
  for (const match of source.matchAll(RELATIVE_SPECIFIER_RE)) {
    try {
      deps.add(new URL(match[1], baseUrl).href);
    } catch {
      // Unresolvable specifier: nothing to repair.
    }
  }
  return [...deps];
}

interface RepairOptions {
  fetchImpl?: typeof fetch;
  maxFiles?: number;
}

/**
 * Refetch `startUrl` and everything it imports with the HTTP cache bypassed,
 * replacing any poisoned entries. Resolves with the URLs actually refetched.
 * Never rejects: a failed asset is skipped so the caller can still reload.
 */
export async function repairAssetCache(
  startUrl: string,
  { fetchImpl = fetch, maxFiles = DEFAULT_MAX_FILES }: RepairOptions = {},
): Promise<string[]> {
  const queued = new Set<string>([startUrl]);
  const repaired: string[] = [];
  const pending = [startUrl];

  while (pending.length > 0 && repaired.length < maxFiles) {
    const url = pending.shift() as string;
    let source: string;
    try {
      const response = await fetchImpl(url, { cache: 'reload', credentials: 'omit' });
      source = await response.text();
    } catch {
      continue;
    }
    repaired.push(url);
    for (const dep of parseChunkDeps(source, url)) {
      if (!queued.has(dep)) {
        queued.add(dep);
        pending.push(dep);
      }
    }
  }

  return repaired;
}

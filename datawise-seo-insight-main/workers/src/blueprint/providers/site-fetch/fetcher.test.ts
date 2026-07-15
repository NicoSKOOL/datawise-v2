import { describe, it, expect, afterEach } from 'vitest';
import {
  fetchTextResource,
  fetchPageTitle,
  extractTitle,
  SiteFetchError,
} from './fetcher';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function headersOf(obj: Record<string, string>) {
  const map = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (k: string) => map.get(k.toLowerCase()) ?? null };
}

function streamOf(bytes: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

interface FakeResponseSpec {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  chunkSize?: number;
}

function fakeResponse(spec: FakeResponseSpec = {}) {
  const bytes = typeof spec.body === 'string' ? new TextEncoder().encode(spec.body) : spec.body ?? new Uint8Array(0);
  return {
    status: spec.status ?? 200,
    headers: headersOf(spec.headers ?? {}),
    body: streamOf(bytes, spec.chunkSize ?? Math.max(bytes.byteLength, 1)),
  } as unknown as Response;
}

// Route stub: maps a request URL to a fake response (or throws).
function stubFetchByUrl(routes: Record<string, FakeResponseSpec>) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    const href = String(url);
    calls.push(href);
    const spec = routes[href];
    if (!spec) throw new Error(`unexpected fetch: ${href}`);
    return fakeResponse(spec);
  }) as any;
  return calls;
}

describe('fetchTextResource SSRF', () => {
  it('rejects a private-IP target before fetching', async () => {
    globalThis.fetch = (async () => {
      throw new Error('fetch should not be called');
    }) as any;
    await expect(fetchTextResource('http://192.168.1.1/robots.txt')).rejects.toMatchObject({
      name: 'SiteFetchError',
      reason: 'ssrf',
    });
  });

  it('rejects localhost', async () => {
    globalThis.fetch = (async () => {
      throw new Error('fetch should not be called');
    }) as any;
    await expect(fetchTextResource('http://localhost/')).rejects.toBeInstanceOf(SiteFetchError);
  });

  it('rejects a non-http(s) scheme', async () => {
    globalThis.fetch = (async () => {
      throw new Error('fetch should not be called');
    }) as any;
    await expect(fetchTextResource('ftp://example.com/x')).rejects.toMatchObject({ reason: 'ssrf' });
  });
});

describe('fetchTextResource redirects', () => {
  it('follows a public redirect and reports the final URL', async () => {
    stubFetchByUrl({
      'http://example.com/a': { status: 301, headers: { location: 'http://example.com/b' } },
      'http://example.com/b': { status: 200, body: 'hello', headers: { 'content-type': 'text/plain' } },
    });
    const res = await fetchTextResource('http://example.com/a');
    expect(res.status).toBe(200);
    expect(res.finalUrl).toBe('http://example.com/b');
    expect(res.body).toBe('hello');
    expect(res.contentType).toBe('text/plain');
  });

  it('re-validates each redirect hop and rejects a redirect to a private IP', async () => {
    stubFetchByUrl({
      'http://example.com/a': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } },
    });
    await expect(fetchTextResource('http://example.com/a')).rejects.toMatchObject({ reason: 'ssrf' });
  });

  it('rejects a redirect to a decimal-encoded private IP', async () => {
    stubFetchByUrl({
      'http://example.com/a': { status: 301, headers: { location: 'http://2130706433/' } }, // 127.0.0.1
    });
    await expect(fetchTextResource('http://example.com/a')).rejects.toMatchObject({ reason: 'ssrf' });
  });

  it('caps redirects', async () => {
    stubFetchByUrl({
      'http://example.com/0': { status: 301, headers: { location: 'http://example.com/1' } },
      'http://example.com/1': { status: 301, headers: { location: 'http://example.com/2' } },
      'http://example.com/2': { status: 301, headers: { location: 'http://example.com/3' } },
      'http://example.com/3': { status: 301, headers: { location: 'http://example.com/4' } },
      'http://example.com/4': { status: 200, body: 'ok' },
    });
    await expect(fetchTextResource('http://example.com/0')).rejects.toMatchObject({ reason: 'too_many_redirects' });
  });
});

describe('fetchTextResource body handling', () => {
  it('returns HTTP error status without throwing', async () => {
    stubFetchByUrl({ 'http://example.com/robots.txt': { status: 404, body: '' } });
    const res = await fetchTextResource('http://example.com/robots.txt');
    expect(res.status).toBe(404);
    expect(res.body).toBe('');
    expect(res.truncated).toBe(false);
  });

  it('truncates a body over the 2MB budget and flags it', async () => {
    const big = 'a'.repeat(2 * 1024 * 1024 + 500);
    stubFetchByUrl({ 'http://example.com/sitemap.xml': { status: 200, body: big } });
    const res = await fetchTextResource('http://example.com/sitemap.xml');
    expect(res.truncated).toBe(true);
    expect(new TextEncoder().encode(res.body).byteLength).toBe(2 * 1024 * 1024);
  });

  it('does not flag truncation for a body under budget read in multiple chunks', async () => {
    stubFetchByUrl({ 'http://example.com/x': { status: 200, body: 'abcdefghij', chunkSize: 3 } });
    const res = await fetchTextResource('http://example.com/x');
    expect(res.body).toBe('abcdefghij');
    expect(res.truncated).toBe(false);
  });
});

describe('fetchTextResource timeout', () => {
  it('aborts and throws a timeout error', async () => {
    globalThis.fetch = ((_url: any, init?: any) => {
      const signal: AbortSignal = init.signal;
      return new Promise((_resolve, reject) => {
        if (signal.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    }) as any;
    await expect(fetchTextResource('http://example.com/slow', { timeoutMs: 5 })).rejects.toMatchObject({
      reason: 'timeout',
    });
  });

  it('maps a network failure to reason network', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as any;
    await expect(fetchTextResource('http://example.com/x')).rejects.toMatchObject({ reason: 'network' });
  });
});

describe('extractTitle', () => {
  it('extracts, decodes entities, and collapses whitespace', () => {
    expect(extractTitle('<html><head><title>  Foo &amp;  Bar\n</title></head></html>')).toBe('Foo & Bar');
  });
  it('returns null when there is no title', () => {
    expect(extractTitle('<html><head></head></html>')).toBeNull();
  });
  it('returns null for an empty title', () => {
    expect(extractTitle('<title>   </title>')).toBeNull();
  });
});

describe('fetchPageTitle', () => {
  it('returns the title and blocked=false for a normal page', async () => {
    stubFetchByUrl({
      'http://example.com/about': {
        status: 200,
        body: '<html><head><title>About Us</title></head><body><h1>About</h1><p>real content here</p></body></html>',
      },
    });
    const res = await fetchPageTitle('http://example.com/about');
    expect(res.title).toBe('About Us');
    expect(res.blocked).toBe(false);
    expect(res.status).toBe(200);
  });

  it('flags a bot-challenge interstitial as blocked', async () => {
    stubFetchByUrl({
      'http://example.com/x': {
        status: 200,
        body: '<html><head><title>Just a moment...</title></head><body>Checking your browser before accessing</body></html>',
      },
    });
    const res = await fetchPageTitle('http://example.com/x');
    expect(res.blocked).toBe(true);
  });

  it('flags an anomalous success status with an empty body as blocked', async () => {
    stubFetchByUrl({ 'http://example.com/x': { status: 218, body: '' } });
    const res = await fetchPageTitle('http://example.com/x');
    expect(res.blocked).toBe(true);
    expect(res.title).toBeNull();
  });
});

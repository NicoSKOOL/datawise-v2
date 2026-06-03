// Shared outbound fetch wrapper that blocks SSRF pivots to internal ranges
// and common cloud metadata endpoints. Use this anywhere a caller-controlled
// URL is fetched by the Worker.

// Outbound User-Agent for our own crawl/scrape fetches (meta checker, sitemap
// discovery, page-context pulls). A self-identifying "DataWiseBot" UA gets a
// blanket 403 from WAF/bot-protection on many WooCommerce/Cloudflare sites
// (confirmed 2026-06-03 on bradsbikes.com.au + resortstylebeanbags.com.au:
// 403 to DataWiseBot, 200 + full content to this string). SEO crawlers
// (Screaming Frog, Ahrefs) all send a browser UA by default for the same
// reason. Keep this in sync with the value verified to return 200.
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
]);

// IPv4 literal? e.g. 10.0.0.1
function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  if (parts.some(p => p < 0 || p > 255)) return null;
  return parts;
}

function isPrivateIPv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isIPv6Literal(host: string): boolean {
  // Workers URL parser strips the brackets; accept either raw or bracketed
  const stripped = host.replace(/^\[|\]$/g, '');
  return stripped.includes(':');
}

export class UnsafeUrlError extends Error {}

export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError('invalid_url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new UnsafeUrlError('unsupported_scheme');
  }
  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) throw new UnsafeUrlError('blocked_host');
  if (host.endsWith('.internal') || host.endsWith('.local')) {
    throw new UnsafeUrlError('blocked_host');
  }
  const v4 = parseIPv4(host);
  if (v4) {
    if (isPrivateIPv4(v4)) throw new UnsafeUrlError('blocked_ip');
    return u;
  }
  if (isIPv6Literal(host)) {
    // Reject raw IPv6 literals outright — too many edge cases for allowlisting.
    throw new UnsafeUrlError('blocked_ipv6');
  }
  return u;
}

interface SafeFetchOptions extends RequestInit {
  // Hard cap on response body size in bytes (default 2 MiB).
  maxBytes?: number;
  // Request timeout in ms (default 15s).
  timeoutMs?: number;
}

export async function safeFetch(rawUrl: string, init: SafeFetchOptions = {}): Promise<Response> {
  assertSafeUrl(rawUrl);
  const { maxBytes = 2 * 1024 * 1024, timeoutMs = 15_000, redirect, ...rest } = init;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(rawUrl, {
      ...rest,
      // Never follow redirects blindly — re-validate below.
      redirect: 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  // Manual redirect handling: validate each hop with the same guard.
  let hop = 0;
  while (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
    if (redirect === 'error') throw new UnsafeUrlError('redirect_blocked');
    if (++hop > 5) throw new UnsafeUrlError('too_many_redirects');
    const next = new URL(response.headers.get('location')!, rawUrl).toString();
    assertSafeUrl(next);
    const r2Controller = new AbortController();
    const r2Timer = setTimeout(() => r2Controller.abort(), timeoutMs);
    try {
      response = await fetch(next, {
        ...rest,
        redirect: 'manual',
        signal: r2Controller.signal,
      });
    } finally {
      clearTimeout(r2Timer);
    }
    rawUrl = next;
  }

  // Enforce size cap by wrapping the body stream.
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      reader.cancel().catch(() => {});
      throw new UnsafeUrlError('response_too_large');
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) {
    combined.set(c, offset);
    offset += c.byteLength;
  }
  return new Response(combined, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

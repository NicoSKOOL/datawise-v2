import { BlueprintValidationError } from './errors';

export function normalizeDomain(input: string): string {
  const raw = input.trim().toLowerCase();
  if (!raw || /\s/.test(raw)) {
    throw new BlueprintValidationError('invalid_domain', [{ path: 'domain', message: `Invalid domain: ${input}` }]);
  }
  let url: URL;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    throw new BlueprintValidationError('invalid_domain', [{ path: 'domain', message: `Invalid domain: ${input}` }]);
  }
  let host = url.hostname;
  // Canonicalize a single trailing dot (FQDN form) and reject empty labels.
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (!host || host.split('.').some((label) => label.length === 0)) {
    throw new BlueprintValidationError('invalid_domain', [{ path: 'domain', message: `Invalid domain: ${input}` }]);
  }
  if (!host.includes('.')) {
    throw new BlueprintValidationError('invalid_domain', [{ path: 'domain', message: `Invalid domain: ${input}` }]);
  }
  // Strip leading www only when a registrable name remains (www.example.com -> example.com, but www.com stays).
  if (host.startsWith('www.') && host.split('.').length > 2) host = host.slice(4);
  return host;
}

export function normalizeAbsoluteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new BlueprintValidationError('invalid_url', [{ path: 'url', message: `Invalid URL: ${input}` }]);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BlueprintValidationError('invalid_url', [{ path: 'url', message: 'Only http/https URLs are allowed' }]);
  }
  if (url.username || url.password) {
    throw new BlueprintValidationError('invalid_url', [{ path: 'url', message: 'URLs with credentials are not allowed' }]);
  }
  if (url.hash) {
    throw new BlueprintValidationError('invalid_url', [{ path: 'url', message: 'URL fragments are not allowed' }]);
  }
  return url;
}

// SSRF guard for any websiteUrl a provider stage will actually fetch.
// normalizeAbsoluteUrl already rejects garbage, non-http(s) schemes,
// credentials, and fragments; this layers on a private/internal-host
// rejection so a project can never point provider fetches at localhost,
// RFC1918/link-local ranges, or an IPv6 host.
const PRIVATE_HOST = /^(localhost|.*\.local|(\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\])$/i;
const PRIVATE_IPV4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

// One octet of an inet_aton-style numeric IPv4 host. Classic inet_aton (and the
// WHATWG URL parser for special schemes) accepts each part as hex (0x..), octal
// (leading 0), or decimal. Returns the numeric value, or null when the token is
// not a valid numeric octet (which is how a normal DNS label like "123movies" or
// "com" disqualifies the whole host from numeric interpretation).
function parseIpv4Part(token: string): number | null {
  if (/^0x[0-9a-f]+$/.test(token)) return parseInt(token.slice(2), 16);
  if (/^0[0-7]+$/.test(token)) return parseInt(token, 8);
  if (/^(0|[1-9][0-9]*)$/.test(token)) return parseInt(token, 10);
  return null;
}

// If `host` is a numeric IPv4 in ANY inet_aton form (1 to 4 parts, each part
// decimal/octal/hex, per classic inet_aton overflow semantics), canonicalize it
// to dotted-quad so the private-range checks below see 127.0.0.1 rather than
// 2130706433 / 0x7f000001 / 0177.0.0.1. Returns null for anything that is not a
// pure numeric host (ordinary hostnames, IPv6 literals, malformed input), which
// then flows through the normal string checks unchanged.
//
// This is defense in depth and runtime-independent: Node's URL parser already
// folds these encodings to dotted-quad, but the Workers runtime this actually
// runs in must not be trusted to, so the guard normalizes them itself rather
// than relying on the URL implementation. A hostname that merely STARTS with
// digits (e.g. 123movies.example.com) is NOT numeric: its non-numeric label
// makes parseIpv4Part return null.
//
// Exported for direct unit testing: in Node the URL parser folds these encodings
// to dotted-quad before assertPublicWebTarget ever sees them, so an end-to-end
// test cannot prove this normalization runs. Testing it directly does.
export function numericIpv4ToDottedQuad(host: string): string | null {
  const parts = host.split('.');
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    const value = parseIpv4Part(part);
    if (value === null) return null;
    nums.push(value);
  }
  let n: number;
  switch (nums.length) {
    case 1:
      n = nums[0];
      if (n > 0xffffffff) return null;
      break;
    case 2:
      if (nums[0] > 0xff || nums[1] > 0xffffff) return null;
      n = nums[0] * 0x1000000 + nums[1];
      break;
    case 3:
      if (nums[0] > 0xff || nums[1] > 0xff || nums[2] > 0xffff) return null;
      n = nums[0] * 0x1000000 + nums[1] * 0x10000 + nums[2];
      break;
    default: // 4 parts
      if (nums.some((x) => x > 0xff)) return null;
      n = nums[0] * 0x1000000 + nums[1] * 0x10000 + nums[2] * 0x100 + nums[3];
      break;
  }
  const b0 = Math.floor(n / 0x1000000) % 256;
  const b1 = Math.floor(n / 0x10000) % 256;
  const b2 = Math.floor(n / 0x100) % 256;
  const b3 = n % 256;
  return `${b0}.${b1}.${b2}.${b3}`;
}

export function assertPublicWebTarget(rawUrl: string): string {
  const normalized = normalizeAbsoluteUrl(rawUrl); // throws on garbage / non-http(s)
  const host = normalized.hostname.toLowerCase();
  // For a numeric IPv4 host in any encoding, run the private-range checks against
  // its dotted-quad form; otherwise strip IPv6 brackets and check the host string.
  const numericIpv4 = numericIpv4ToDottedQuad(host);
  const ipForCheck = numericIpv4 ?? host.replace(/^\[/, '').replace(/\]$/, '');
  if (PRIVATE_HOST.test(host) || PRIVATE_IPV4.test(ipForCheck) || ipForCheck === '::1') {
    throw new BlueprintValidationError('invalid_website_url', [
      { path: 'websiteUrl', message: 'URL must be a public website' },
    ]);
  }
  return normalized.href;
}

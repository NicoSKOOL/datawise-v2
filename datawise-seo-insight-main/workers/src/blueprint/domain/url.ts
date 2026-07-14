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

export function assertPublicWebTarget(rawUrl: string): string {
  const normalized = normalizeAbsoluteUrl(rawUrl); // throws on garbage / non-http(s)
  const host = normalized.hostname.toLowerCase();
  const bareIp = host.replace(/^\[/, '').replace(/\]$/, '');
  if (PRIVATE_HOST.test(host) || PRIVATE_IPV4.test(bareIp) || bareIp === '::1') {
    throw new BlueprintValidationError('invalid_website_url', [
      { path: 'websiteUrl', message: 'URL must be a public website' },
    ]);
  }
  return normalized.href;
}

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

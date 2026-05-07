export class UnsafeUrlError extends Error {
  constructor(message = 'Unsafe URL') {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function assertSafeUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError('Only http and https URLs are allowed');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    hostname.startsWith('fc') ||
    hostname.startsWith('fd') ||
    hostname.startsWith('fe80') ||
    isPrivateIpv4(hostname)
  ) {
    throw new UnsafeUrlError('Private and local URLs are not allowed');
  }

  return url;
}

export function safeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const raw =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input.toString()
        : input;
  assertSafeUrl(raw);
  return fetch(input, init);
}

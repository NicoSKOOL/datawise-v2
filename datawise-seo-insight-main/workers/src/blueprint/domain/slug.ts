// Root-relative, lowercase, ascii-safe path with a single trailing slash policy.
export function normalizeSlug(input: string): string {
  const withoutOrigin = input.trim().replace(/^https?:\/\/[^/]+/i, '');
  const segments = withoutOrigin
    .split('/')
    .map((segment) =>
      segment
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean);
  return segments.length ? `/${segments.join('/')}/` : '/';
}

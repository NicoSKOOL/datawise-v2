// Where to send the user after login. Used by /connect (the MCP consent page)
// because ProtectedRoute and the Google callback always land on "/".
// sessionStorage: same tab only, survives the Google OAuth redirect chain.
export const RETURN_TO_KEY = 'datawise_return_to';

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' || sessionStorage === null ? null : sessionStorage;
  } catch {
    return null;
  }
}

function isAppPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//');
}

export function setReturnTo(path: string): void {
  if (!isAppPath(path)) return;
  const s = storage();
  if (!s) return;
  try {
    s.setItem(RETURN_TO_KEY, path);
  } catch {
    // quota or security error: nothing we can do, just skip storing it
  }
}

export function consumeReturnTo(): string | null {
  const s = storage();
  if (!s) return null;
  try {
    const value = s.getItem(RETURN_TO_KEY);
    s.removeItem(RETURN_TO_KEY);
    return value && isAppPath(value) ? value : null;
  } catch {
    return null;
  }
}

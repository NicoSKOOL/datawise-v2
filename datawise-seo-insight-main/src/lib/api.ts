const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8787';

const SESSION_KEY = 'datawise_session_token';

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string): void {
  localStorage.setItem(SESSION_KEY, token);
}

export function clearSessionToken(): void {
  localStorage.removeItem(SESSION_KEY);
}

export class OutOfCreditsError extends Error {
  credits_used: number;
  credits_limit: number;

  constructor(credits_used: number, credits_limit: number) {
    super('out_of_credits');
    this.name = 'OutOfCreditsError';
    this.credits_used = credits_used;
    this.credits_limit = credits_limit;
  }
}

// Global event for out-of-credits (components can listen to this)
export const outOfCreditsEvent = new EventTarget();

interface ApiOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  });

  if (response.status === 401) {
    // For auth endpoints (login, signup, reset), pass through the real error
    // so the user sees "Invalid email or password" instead of generic "Unauthorized"
    if (path.startsWith('/auth/')) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error((errorData as any).error || 'Unauthorized');
    }
    // For all other routes, session is expired - redirect to login
    clearSessionToken();
    window.location.href = '/auth';
    throw new Error('Unauthorized');
  }

  if (response.status === 403) {
    const errorData = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (errorData.error === 'out_of_credits') {
      const err = new OutOfCreditsError(
        errorData.credits_used as number,
        errorData.credits_limit as number,
      );
      outOfCreditsEvent.dispatchEvent(new CustomEvent('out_of_credits'));
      throw err;
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error((errorData as any).error || `API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// Streaming fetch for LLM chat responses
export async function apiStream(
  path: string,
  body: unknown,
  onChunk: (text: string) => void
): Promise<void> {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Stream error: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

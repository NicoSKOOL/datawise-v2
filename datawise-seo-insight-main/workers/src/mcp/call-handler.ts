import type { Env } from '../index';
import type { McpEnv } from './env';
import { asWorkerEnv } from './env';

export class HandlerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HandlerError';
    this.status = status;
  }
}

// Every POST-shaped route handler in workers/src/routes has this shape (some
// ignore the third argument). TypeScript accepts two-arg handlers here.
export type JsonHandler = (request: Request, env: Env, userId: string) => Promise<Response>;

export async function readJson<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) {
    const base = parsed?.error ?? `Handler returned ${response.status}`;
    const detail = parsed?.detail ? `: ${parsed.detail}` : '';
    throw new HandlerError(response.status, `${base}${detail}`);
  }
  return parsed as T;
}

// Runs an existing route handler exactly as the API worker would, minus the
// router, CORS and credit wrapper. The synthetic URL only matters for GET
// handlers that read searchParams; pass one when needed.
export async function callJson<T = any>(
  env: McpEnv,
  userId: string,
  handler: JsonHandler,
  body: unknown,
  url = 'https://mcp.internal/',
): Promise<T> {
  const request = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const response = await handler(request, asWorkerEnv(env), userId);
  return readJson<T>(response);
}

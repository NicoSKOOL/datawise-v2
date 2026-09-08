import type { McpEnv } from './env';

export async function handleAuthorize(_request: Request, _env: McpEnv): Promise<Response> {
  return new Response('not wired', { status: 501 });
}

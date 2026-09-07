import type { McpEnv } from './env';
export async function handleAccountRequest(_request: Request, _env: McpEnv): Promise<Response> {
  return new Response(JSON.stringify({ error: 'not_implemented' }), { status: 501, headers: { 'Content-Type': 'application/json' } });
}

import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv } from './test-support';
import { callJson, readJson, HandlerError } from './call-handler';

describe('callJson', () => {
  it('posts the body as JSON and returns the parsed response', async () => {
    const { env } = makeMcpTestEnv();
    const handler = async (request: Request) => {
      const body = await request.json();
      return new Response(JSON.stringify({ echoed: body, method: request.method }), { headers: { 'Content-Type': 'application/json' } });
    };
    const out = await callJson(env, 'u1', handler, { keyword: 'x' });
    expect(out).toEqual({ echoed: { keyword: 'x' }, method: 'POST' });
  });

  it('throws HandlerError with the handler status and error text', async () => {
    const { env } = makeMcpTestEnv();
    const handler = async () => new Response(JSON.stringify({ error: 'Target domain is required' }), { status: 400 });
    await expect(callJson(env, 'u1', handler, {})).rejects.toMatchObject({ status: 400, message: 'Target domain is required' });
    const h502 = async () => new Response(JSON.stringify({ error: 'DataForSEO request failed', detail: 'boom' }), { status: 502 });
    await expect(callJson(env, 'u1', h502, {})).rejects.toMatchObject({ status: 502, message: 'DataForSEO request failed: boom' });
    await expect(callJson(env, 'u1', h502, {})).rejects.toBeInstanceOf(HandlerError);
  });

  it('readJson works for GET-style handlers', async () => {
    const res = new Response(JSON.stringify([{ id: 1 }]));
    expect(await readJson(res)).toEqual([{ id: 1 }]);
    await expect(readJson(new Response(JSON.stringify({ error: 'Project not found' }), { status: 404 }))).rejects.toMatchObject({ status: 404 });
  });
});

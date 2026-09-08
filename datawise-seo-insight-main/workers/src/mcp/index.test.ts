import { describe, it, expect } from 'vitest';
import { makeMcpTestEnv } from './test-support';
import worker from './index';

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe('datawise-mcp scheduled', () => {
  it('purges mcp_calls older than 30 days and sweeps OAuth KV without throwing', async () => {
    const { env, raw } = makeMcpTestEnv();
    raw.prepare("INSERT INTO mcp_calls (user_id, tool, auth_kind, created_at) VALUES ('u','t','api_token', datetime('now','-31 days')), ('u','t','api_token', datetime('now'))").run();
    await worker.scheduled({} as ScheduledEvent, env, ctx);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM mcp_calls').get() as any).n).toBe(1);
  });
});

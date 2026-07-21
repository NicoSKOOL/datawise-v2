import { describe, it, expect } from 'vitest';
import { handleGetLLMConfig, handlePutLLMConfig, handleDeleteLLMConfig } from './llm-config';
import { isEncryptedToken } from '../lib/token-crypto';

// Minimal in-memory stand-in for the three D1 statements this module runs.
function makeEnv() {
  const rows = new Map<string, { config_encrypted: string }>();
  const env = {
    ENCRYPTION_KEY: 'test-encryption-key',
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async first() {
                if (/SELECT config_encrypted/i.test(sql)) {
                  return rows.get(args[0] as string) ?? null;
                }
                return null;
              },
              async run() {
                if (/INSERT INTO user_llm_configs/i.test(sql)) {
                  rows.set(args[0] as string, { config_encrypted: args[1] as string });
                } else if (/DELETE FROM user_llm_configs/i.test(sql)) {
                  rows.delete(args[0] as string);
                }
                return { success: true };
              },
            };
          },
        };
      },
    },
    __rows: rows,
  } as any;
  return env;
}

const user = { id: 'u1', email: 'member@example.com' } as any;
const otherUser = { id: 'u2', email: 'other@example.com' } as any;

function putReq(body: unknown) {
  return new Request('https://api/api/llm-config', {
    method: 'PUT',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('llm-config routes', () => {
  it('GET returns null config when nothing stored', async () => {
    const env = makeEnv();
    const res = await handleGetLLMConfig(env, user);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: null });
  });

  it('PUT then GET roundtrips the config and stores it encrypted at rest', async () => {
    const env = makeEnv();
    const key = 'sk-or-v1-0123456789abcdef0123456789abcdef';
    const put = await handlePutLLMConfig(putReq({ api_key: key, model: 'openai/gpt-5-mini' }), env, user);
    expect(put.status).toBe(200);
    const stored = env.__rows.get('u1').config_encrypted;
    expect(isEncryptedToken(stored)).toBe(true);
    expect(stored).not.toContain(key);
    const res = await handleGetLLMConfig(env, user);
    expect(await res.json()).toEqual({
      config: { provider: 'openrouter', api_key: key, model: 'openai/gpt-5-mini' },
    });
  });

  it('PUT twice overwrites (upsert)', async () => {
    const env = makeEnv();
    await handlePutLLMConfig(putReq({ api_key: 'sk-or-v1-aaaaaaaaaaaaaaaaaaaa' }), env, user);
    await handlePutLLMConfig(putReq({ api_key: 'sk-or-v1-bbbbbbbbbbbbbbbbbbbb' }), env, user);
    const res = await handleGetLLMConfig(env, user);
    const body = await res.json() as any;
    expect(body.config.api_key).toBe('sk-or-v1-bbbbbbbbbbbbbbbbbbbb');
  });

  it('DELETE removes the config and is idempotent', async () => {
    const env = makeEnv();
    await handlePutLLMConfig(putReq({ api_key: 'sk-or-v1-aaaaaaaaaaaaaaaaaaaa' }), env, user);
    expect((await handleDeleteLLMConfig(env, user)).status).toBe(200);
    expect(await (await handleGetLLMConfig(env, user)).json()).toEqual({ config: null });
    expect((await handleDeleteLLMConfig(env, user)).status).toBe(200);
  });

  it('rejects malformed bodies and non-OpenRouter keys with 400', async () => {
    const env = makeEnv();
    const bad = [
      putReq({}),
      putReq({ api_key: 42 }),
      putReq({ api_key: 'sk-proj-notopenrouter0123456789' }),
      putReq({ api_key: 'sk-or-tiny' }),
      putReq({ api_key: 'sk-or-' + 'x'.repeat(400) }),
      putReq('not json'),
    ];
    for (const r of bad) {
      expect((await handlePutLLMConfig(r, env, user)).status).toBe(400);
    }
    expect(env.__rows.size).toBe(0);
  });

  it('scopes rows by the session user, one user cannot read another', async () => {
    const env = makeEnv();
    await handlePutLLMConfig(putReq({ api_key: 'sk-or-v1-aaaaaaaaaaaaaaaaaaaa' }), env, user);
    const res = await handleGetLLMConfig(env, otherUser);
    expect(await res.json()).toEqual({ config: null });
  });

  it('returns null (not 500) when the stored blob cannot be decrypted', async () => {
    const env = makeEnv();
    env.__rows.set('u1', { config_encrypted: 'enc:v1:garbage.notreal' });
    const res = await handleGetLLMConfig(env, user);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ config: null });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../index';
import { getRunJson, putRunJson } from './storage';

describe('run storage', () => {
  it('retries a transient R2 error on put and get', async () => {
    const put = vi.fn()
      .mockRejectedValueOnce(new Error('put: We encountered an internal error. Please try again. (10001)'))
      .mockResolvedValue(undefined);
    const get = vi.fn()
      .mockRejectedValueOnce(new Error('get: internal error (10001)'))
      .mockResolvedValue({ json: async () => ({ ok: 1 }) });
    const env = { TASK_ATTACHMENTS: { put, get } } as unknown as Env;
    await putRunJson(env, 'r', 'x', { a: 1 });
    expect(put).toHaveBeenCalledTimes(2);
    expect(await getRunJson(env, 'r', 'x')).toEqual({ ok: 1 });
  });

  it('gives up after three attempts', async () => {
    const put = vi.fn().mockRejectedValue(new Error('down'));
    const env = { TASK_ATTACHMENTS: { put } } as unknown as Env;
    await expect(putRunJson(env, 'r', 'x', {})).rejects.toThrow('down');
    expect(put).toHaveBeenCalledTimes(3);
  });
});

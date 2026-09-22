import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestDb } from '../test-support/d1';

// SEO Assistant replies were not persisted (981/1176 conversations had no
// assistant row): the save ran as a dangling promise outside ctx.waitUntil,
// only wrote after a fully-read stream, and a provider failure left an orphan
// user message.

const chatMock = vi.fn();
vi.mock('../llm/provider', () => ({
  getLLMProvider: () => ({ chat: chatMock }),
}));

import { handleChat } from './handler';

const enc = new TextEncoder();

function setup() {
  const { d1, raw } = createTestDb();
  raw.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com')").run();
  const env = { DB: d1 } as any;
  const waitUntil = vi.fn();
  const ctx = { waitUntil, passThroughOnException: () => {} } as unknown as ExecutionContext;
  return { env, raw, ctx, waitUntil };
}

function chatRequest(message: string) {
  return new Request('https://api.test/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

function assistantRows(raw: ReturnType<typeof createTestDb>['raw']) {
  return raw.prepare("SELECT content FROM chat_messages WHERE role = 'assistant'").all() as { content: string }[];
}

describe('handleChat assistant reply persistence', () => {
  beforeEach(() => { chatMock.mockReset(); });

  it('registers the save with ctx.waitUntil and writes the reply after the stream completes', async () => {
    const { env, raw, ctx, waitUntil } = setup();
    chatMock.mockResolvedValue(new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('Hello '));
        c.enqueue(enc.encode('world'));
        c.close();
      },
    }));

    const res = await handleChat(chatRequest('hi'), env, 'u1', ctx);
    expect(res.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);

    expect(await res.text()).toBe('Hello world');
    await waitUntil.mock.calls[0][0];
    expect(assistantRows(raw).map((r) => r.content)).toEqual(['Hello world']);
  });

  it('saves the partial reply when the stream errors mid-way', async () => {
    const { env, raw, ctx, waitUntil } = setup();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    chatMock.mockResolvedValue(new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        c.enqueue(enc.encode('Partial answer'));
      },
    }));

    const res = await handleChat(chatRequest('hi'), env, 'u1', ctx);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    // Let the save branch read the first chunk, then kill the stream.
    await new Promise((r) => setTimeout(r, 0));
    controller.error(new Error('provider dropped'));

    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    await res.body?.cancel().catch(() => {});
    expect(assistantRows(raw).map((r) => r.content)).toEqual(['Partial answer']);
  });

  it('saves an error assistant row when the provider fails, keeping the 502 response', async () => {
    const { env, raw, ctx, waitUntil } = setup();
    chatMock.mockImplementation(async () => { throw new Error('OpenRouter rejected your API key (401)'); });

    const res = await handleChat(chatRequest('hi'), env, 'u1', ctx);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'OpenRouter rejected your API key (401)' });
    expect(waitUntil).not.toHaveBeenCalled();

    const rows = raw.prepare('SELECT role, content FROM chat_messages ORDER BY rowid').all() as { role: string; content: string }[];
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
    expect(rows[1].content).toMatch(/AI provider returned an error/);
  });

  it('does not send a saved provider-error reply back to the model as history', async () => {
    const { env, raw, ctx } = setup();
    chatMock.mockImplementationOnce(async () => { throw new Error('boom'); });
    await handleChat(chatRequest('first question'), env, 'u1', ctx);
    const { id: convId } = raw.prepare('SELECT id FROM chat_conversations').get() as { id: string };

    chatMock.mockResolvedValueOnce(new ReadableStream({ start(c) { c.close(); } }));
    await handleChat(new Request('https://api.test/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'second question', conversation_id: convId }),
    }), env, 'u1', ctx);

    const sent = chatMock.mock.calls[1][0] as { role: string; content: string }[];
    expect(sent.filter((m) => m.role !== 'system').map((m) => m.content))
      .toEqual(['first question', 'second question']);
  });
});

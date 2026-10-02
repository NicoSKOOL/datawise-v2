// Calls the writing model for one allocated link and validates the reply.
// Billed to the member's own OpenRouter key, like every Jev call.

import { anchorPrompt, validateAnchor } from './anchors';
import { JevAuthError } from './jev';
import type { Allocation } from './types';

// Same default as the Python tool (WRITER_MODEL).
export const ANCHOR_MODEL = 'anthropic/claude-sonnet-5';
const URL_ = 'https://openrouter.ai/api/v1/chat/completions';

export interface AnchorResult {
  anchor: string | null;
  cost: number;
  error?: string;
}

export async function writeAnchor(
  link: Allocation,
  targetDesc: string,
  apiKey: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number; deadline?: number } = {}
): Promise<AnchorResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = opts.deadline ?? Infinity;
  const body = JSON.stringify({
    model: ANCHOR_MODEL,
    messages: [{ role: 'user', content: anchorPrompt(link.text, link.target_title, targetDesc || link.target_title) }],
    max_tokens: 120,
    temperature: 0,
  });
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(URL_, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < 2 && Date.now() + timeoutMs < deadline) continue;
      return { anchor: null, cost: 0, error: err instanceof Error ? err.message : String(err) };
    }
    const wait = 2 ** attempt * 1000 + Math.random() * 500;
    if ([429, 500, 502, 503].includes(res.status) && attempt < 3 && Date.now() + wait + timeoutMs < deadline) {
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status === 401 || res.status === 402) {
      throw new JevAuthError(
        res.status === 402
          ? 'Your OpenRouter account is out of credits. Top it up and resume the run.'
          : 'OpenRouter rejected your API key. Update it in Settings and resume the run.'
      );
    }
    if (!res.ok) return { anchor: null, cost: 0, error: `HTTP ${res.status}` };
    const d = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: { cost?: number };
    };
    const text = d.choices?.[0]?.message?.content ?? '';
    const v = validateAnchor(text, link.text);
    return { anchor: 'anchor' in v ? v.anchor : null, cost: d.usage?.cost ?? 0 };
  }
}

// One Jev call per source paragraph: which shortlisted page does the reader
// need next? Port of score.py. Jev is OpenRouter's decision model; it returns
// choices and probabilities, never text.

import { JEV_DECISIONS_URL, JEV_MODEL } from './config';
import type { Candidate, JevResponse } from './types';

/** Small, focused state. Jev degrades on large irrelevant context. */
export function buildState(c: Candidate): string {
  const lines = [
    `PAGE: ${c.source_title}`,
    '',
    'PARAGRAPH ON THAT PAGE:',
    c.text,
    '',
    'CANDIDATE PAGES TO LINK TO:',
  ];
  c.targets.forEach((t, i) => {
    const desc = (t.description || t.h1 || '').slice(0, 200);
    lines.push(`${i + 1}. ${t.title} — ${desc}`);
  });
  return lines.join('\n');
}

export function buildQuestions(c: Candidate) {
  const opts: Record<string, string> = {};
  c.targets.forEach((t, i) => {
    opts[String(i + 1)] = t.title.slice(0, 120);
  });
  opts.none = 'None of these pages is a genuinely useful next step here';
  return {
    best_target: {
      type: 'choice',
      instructions:
        'A reader has just read this paragraph. Which candidate page ' +
        'is the most useful next step for them? Choose \'none\' unless ' +
        'one page clearly deepens the specific topic of THIS paragraph.',
      criteria: opts,
    },
    link_warranted: {
      type: 'noul',
      instructions:
        'This paragraph raises a specific topic, tool or claim that a ' +
        'reader would plausibly want to explore on another page.',
    },
    anchor_available: {
      type: 'noul',
      instructions:
        'This paragraph contains a specific noun phrase that could ' +
        'become natural anchor text without rewriting the sentence.',
    },
    reader_stage: {
      type: 'choice',
      instructions: 'Where is the reader of this paragraph?',
      criteria: {
        learning: 'Understanding a concept for the first time',
        comparing: 'Weighing options, tools or approaches',
        ready: 'Ready to act, buy or sign up',
      },
    },
    commercial: {
      type: 'noul',
      instructions:
        'This paragraph is promotional or sales-oriented rather than ' +
        'educational.',
    },
  };
}

export class JevAuthError extends Error {}

const RETRY_STATUSES = new Set([429, 500, 502, 503]);
const MAX_RETRIES = 5;

/**
 * Ask Jev about one paragraph. Returns {} (no answers) on a non-auth failure
 * so the decision is recorded as an api_error rather than failing the run.
 * Throws JevAuthError on 401/402 so the runner can stop instead of burning
 * through every paragraph with a dead key.
 */
export async function callJev(
  c: Candidate,
  apiKey: string,
  opts: {
    model?: string;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    // Per-attempt timeout, and an absolute time after which no retry starts,
    // so a slice always gets to save before its invocation is cut off.
    timeoutMs?: number;
    deadline?: number;
  } = {}
): Promise<JevResponse & { error?: string }> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const deadline = opts.deadline ?? Infinity;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const body = JSON.stringify({
    model: opts.model ?? JEV_MODEL,
    state: buildState(c),
    questions: buildQuestions(c),
  });

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await doFetch(JEV_DECISIONS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const wait = 2 ** attempt * 1000 + Math.random() * 1000;
      if (attempt < MAX_RETRIES && Date.now() + wait + timeoutMs < deadline) {
        await sleep(wait);
        continue;
      }
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const wait = 2 ** attempt * 1000 + Math.random() * 1000;
    if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES && Date.now() + wait + timeoutMs < deadline) {
      await sleep(wait);
      continue;
    }
    if (res.status === 401 || res.status === 402) {
      throw new JevAuthError(
        res.status === 402
          ? 'Your OpenRouter account is out of credits. Top it up and resume the run.'
          : 'OpenRouter rejected your API key. Update it in Settings and resume the run.'
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: `HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    return (await res.json()) as JevResponse;
  }
}

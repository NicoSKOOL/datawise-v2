import { describe, it, expect, vi } from 'vitest';
import { allocate } from './allocate';
import { stems, validateAnchor, withAnchor, type LinkWithAnchor } from './anchors';
import { buildDecisionRows } from './classify';
import { DEFAULT_CONFIG } from './config';
import { buildQuestions, buildState, callJev, JevAuthError } from './jev';
import type { Allocation, Candidate, Judgement } from './types';
import judgements from './__fixtures__/ghlcurso-judgements.json';
import inbound from './__fixtures__/ghlcurso-inbound.json';
import syntheticLinks from './__fixtures__/ghlcurso-synthetic-links.json';
import expectedOutcomes from './__fixtures__/ghlcurso-expected-outcomes.json';
import expectedBodies from './__fixtures__/ghlcurso-expected-jev-bodies.json';
import expectedStems from './__fixtures__/expected-stems.json';

// Expected values below were produced by the Python jev-internal-links
// scripts (decisions.py, score.py, anchors.py) on the same inputs.

describe('buildDecisionRows (parity with decisions.py)', () => {
  it('assigns every decision the same outcome', () => {
    const js = judgements as Judgement[];
    const { chosen, capLog } = allocate(js, inbound as number[], DEFAULT_CONFIG);
    const anchorByKey = new Map(syntheticLinks.map((l) => [`${l.source_canon}|${l.p_i}`, l.anchor]));
    const links = chosen
      .filter((a) => anchorByKey.has(`${a.source_canon}|${a.p_i}`))
      .map((a) => ({ ...a, anchor: anchorByKey.get(`${a.source_canon}|${a.p_i}`)!, preview: '' }));
    const rows = buildDecisionRows(js, chosen, links, capLog, DEFAULT_CONFIG);
    expect(rows.map((r) => [r.id, r.outcome])).toEqual(expectedOutcomes);
  });
});

describe('Jev request (parity with score.py)', () => {
  it.each(expectedBodies.map((b, i) => [i, b] as const))('candidate %i', (_i, b) => {
    const c = b.candidate as Candidate;
    expect(buildState(c)).toBe(b.state);
    expect(buildQuestions(c)).toEqual(b.questions);
  });
});

describe('anchors (parity with anchors.py)', () => {
  it('stems match', () => {
    for (const [text, want] of Object.entries(expectedStems)) {
      expect([...stems(text)].sort()).toEqual(want);
    }
  });

  const para = 'Antes de vender, revisa cómo funciona el modo SaaS para agencias y cuánto cobrar cada mes.';
  it('accepts a clean verbatim noun phrase', () => {
    expect(validateAnchor('{"anchor": "modo SaaS para agencias"}', para)).toEqual({ anchor: 'modo SaaS para agencias' });
  });
  it('rejects null, non-verbatim, too-short and bad openers', () => {
    expect(validateAnchor('{"anchor": null}', para)).toEqual({ rejected: 'no_anchor' });
    expect(validateAnchor('no json', para)).toEqual({ rejected: 'no_anchor' });
    expect(validateAnchor('{"anchor": "modo saas"}', para)).toEqual({ rejected: 'not_verbatim' });
    expect(validateAnchor('{"anchor": "SaaS"}', para)).toEqual({ rejected: 'bad_shape' });
    expect(validateAnchor('{"anchor": "el modo SaaS"}', para)).toEqual({ rejected: 'bad_shape' });
  });
  it('downgrades an off-topic apply link to review and builds a preview', () => {
    const link = {
      action: 'apply', text: para, target: 'https://x.com/precios/', target_title: 'Precios',
      target_canon: 'x.com/precios/',
    } as Allocation;
    const out: LinkWithAnchor = withAnchor(link, 'modo SaaS para agencias', {});
    expect(out.action).toBe('review');
    expect(out.preview).toContain('[modo SaaS para agencias](https://x.com/precios/)');
    const onTopic = withAnchor({ ...link, target_title: 'Modo SaaS' }, 'modo SaaS para agencias', {});
    expect(onTopic.action).toBe('apply');
  });
});

describe('callJev', () => {
  const c = expectedBodies[0].candidate as Candidate;
  const noSleep = async () => {};

  it('retries 429 then returns answers', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ answers: { x: 1 }, model: 'jev' })));
    const res = await callJev(c, 'k', { fetchImpl, sleep: noSleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(res.model).toBe('jev');
  });

  it('throws on a rejected key instead of recording an api_error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 401 }));
    await expect(callJev(c, 'k', { fetchImpl, sleep: noSleep })).rejects.toBeInstanceOf(JevAuthError);
  });

  it('records other failures as an error with no answers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    const res = await callJev(c, 'k', { fetchImpl, sleep: noSleep });
    expect(res.answers).toBeUndefined();
    expect(res.error).toContain('400');
  });
});

// Internal Links run state machine. A run moves through
//   crawl -> shortlist -> score -> allocate -> anchors -> report -> done
// in short slices. Each slice claims the row lock, does bounded work (a
// wall-clock deadline plus a subrequest budget, since the per-invocation
// subrequest cap is the binding Worker limit), saves progress to R2 and
// releases the lock. Slices run from the status poll (ctx.waitUntil) while
// the member has the page open (it calls POST .../advance in a loop, each
// doing ~45s of work inline), and from the */5 cron so a closed tab still
// finishes. Inline beats ctx.waitUntil here: waitUntil work is cut off 30s
// after the response, which left only a few seconds per slice for Jev
// batches and could kill a slice before it saved. The staging preview
// Worker runs no crons, so there a run only advances while the page is open.

import type { Env } from '../index';
import { allocate } from './allocate';
import { ANCHOR_MODEL, writeAnchor } from './anchor-writer';
import { withAnchor, type LinkWithAnchor } from './anchors';
import { buildDecisionRows } from './classify';
import { DEFAULT_CONFIG, JEV_MODEL, estimateRunCost, type InternalLinksConfig } from './config';
import { callJev, JevAuthError } from './jev';
import { resolveUserOpenRouterKey } from './key';
import { parsePage, type ParsedPage } from './parse-html';
import { buildReport } from './report';
import {
  EMBED_BATCH,
  embed,
  embedBatchSize,
  shortlistBatch,
  sourcePassages,
  targetText,
  withInboundCounts,
  type CrawledPage,
  type SourcePassage,
} from './shortlist';
import { deleteRunJson, getRunJson, putRunJson } from './storage';
import { BROWSER_UA, safeFetch } from '../lib/safe-fetch';
import { isBlockStatus } from './discover';
import { detectBotChallenge } from '../routes/content-tools';
import type { Allocation, Candidate, CapReason, JevResponse, Judgement } from './types';

export type RunStage = 'crawl' | 'shortlist' | 'score' | 'allocate' | 'anchors' | 'report' | 'done';
export type RunStatus = 'running' | 'awaiting_confirmation' | 'completed' | 'failed';

export interface RunRow {
  id: string;
  user_id: string;
  site_url: string;
  sitemap_url: string | null;
  status: RunStatus;
  stage: RunStage;
  cursor: number;
  total: number;
  progress_json: string | null;
  summary_json: string | null;
  approvals_json: string | null;
  cost_usd: number;
  max_cost_usd: number;
  estimated_cost_usd: number | null;
  error: string | null;
  processing_locked_until: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface RunProgress {
  pages_total?: number;
  pages_done?: number;
  pages_failed?: number;
  passages?: number;
  shortlisted?: number;
  candidates?: number;
  judged?: number;
  api_errors?: number;
  allocated?: number;
  anchors_done?: number;
  anchored?: number;
  tokens?: number;
  jev_model?: string;
  // Distribution of each paragraph's best similarity, for tuning the
  // shortlist threshold to bge-m3.
  top_sim_p10?: number;
  top_sim_p50?: number;
  top_sim_p90?: number;
}

export const MAX_PAGES = 300;
const CRAWL_CONCURRENCY = 8;
// One round of parallel calls per batch, so a batch never outlasts one
// per-call timeout and a slice can always save before it is cut off.
const JEV_CONCURRENCY = 20;
const ANCHOR_CONCURRENCY = 8;
// Longer than the longest slice (cron slices run up to 100s).
const LOCK_SECONDS = 150;

interface Budget {
  deadline: number;
  subrequests: number;
  // Writes progress_json for the live display after each batch. Display
  // only: the resume cursor is saved with the stage data at slice end.
  onProgress?: () => Promise<void>;
}

function hasTime(b: Budget, reserveMs = 3000): boolean {
  return Date.now() < b.deadline - reserveMs && b.subrequests > 0;
}

export async function getConfig(env: Env): Promise<InternalLinksConfig> {
  // KV override for the bge-m3 similarity cutoff, so it can be tuned
  // against real runs without a deploy.
  const minSim = Number(await env.KV.get('internal-links-min-sim'));
  if (Number.isFinite(minSim) && minSim > 0 && minSim < 1) {
    return { ...DEFAULT_CONFIG, shortlist: { ...DEFAULT_CONFIG.shortlist, min_similarity: minSim } };
  }
  return DEFAULT_CONFIG;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

function percentile(sorted: number[], p: number): number | undefined {
  if (!sorted.length) return undefined;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] * 1000) / 1000;
}

class RunFailure extends Error {}

// ---------------------------------------------------------------------------
// Stages

interface CrawlState {
  pages: ParsedPage[];
  failed: Array<{ url: string; error: string }>;
  blocked: number;
}

async function fetchPage(url: string): Promise<{ page?: ParsedPage; error?: string; blocked?: boolean }> {
  try {
    const res = await safeFetch(url, {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      timeoutMs: 12_000,
      maxBytes: 4 * 1024 * 1024,
    });
    if (res.status !== 200) return { error: `HTTP ${res.status}`, blocked: isBlockStatus(res.status) };
    const type = res.headers.get('content-type') || '';
    if (type && !type.includes('html')) return { error: `Not HTML (${type.split(';')[0]})` };
    const html = await res.text();
    if (detectBotChallenge(html)) return { error: 'Blocked by an anti-bot challenge', blocked: true };
    return { page: parsePage(url, html) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function stepCrawl(env: Env, run: RunRow, progress: RunProgress, b: Budget, cfg: InternalLinksConfig) {
  const urls = (await getRunJson<string[]>(env, run.id, 'urls')) ?? [];
  const state = (await getRunJson<CrawlState>(env, run.id, 'crawl')) ?? { pages: [], failed: [], blocked: 0 };
  let cursor = run.cursor;

  while (cursor < urls.length && hasTime(b, 15_000)) {
    const batch = urls.slice(cursor, cursor + Math.min(CRAWL_CONCURRENCY, b.subrequests));
    b.subrequests -= batch.length * 2; // a redirect hop is common
    const results = await mapLimit(batch, CRAWL_CONCURRENCY, fetchPage);
    results.forEach((r, i) => {
      if (r.page) state.pages.push(r.page);
      else state.failed.push({ url: batch[i], error: r.error ?? 'unknown' });
      if (r.blocked) state.blocked++;
    });
    cursor += batch.length;
    progress.pages_done = cursor;
    await b.onProgress?.();
  }
  await putRunJson(env, run.id, 'crawl', state);
  progress.pages_total = urls.length;
  progress.pages_done = cursor;
  progress.pages_failed = state.failed.length;

  if (cursor < urls.length) return { cursor };

  // Same page reached by two sitemap URLs (http/https, trailing slash): keep one.
  const seen = new Set<string>();
  const unique = state.pages.filter((p) => (seen.has(p.canon) ? false : (seen.add(p.canon), true)));
  const crawled = withInboundCounts(unique);
  const sources = sourcePassages(crawled, cfg);
  progress.passages = sources.length;

  if (crawled.length < 2 || sources.length === 0) {
    const reason =
      state.blocked > state.pages.length
        ? 'The site blocked our crawler (a firewall refusal or anti-bot challenge), so no page content could be read.'
        : crawled.length < 2
          ? 'Fewer than 2 pages could be fetched, so there is nothing to link between.'
          : 'No paragraphs long enough to hold a link were found. The site may render its content with JavaScript, which this tool cannot read yet.';
    throw new RunFailure(reason);
  }
  await putRunJson(env, run.id, 'pages', crawled);
  await putRunJson(env, run.id, 'sources', sources);
  await deleteRunJson(env, run.id, ['crawl']);
  return { stage: 'shortlist' as RunStage, cursor: 0, total: sources.length };
}

async function stepShortlist(env: Env, run: RunRow, progress: RunProgress, b: Budget, cfg: InternalLinksConfig) {
  const pages = (await getRunJson<CrawledPage[]>(env, run.id, 'pages'))!;
  const sources = (await getRunJson<SourcePassage[]>(env, run.id, 'sources'))!;

  let targetVecs = await getRunJson<number[][]>(env, run.id, 'target_vectors');
  if (!targetVecs) {
    targetVecs = [];
    for (let i = 0; i < pages.length; i += EMBED_BATCH) {
      b.subrequests--;
      targetVecs.push(...(await embed(env.AI, pages.slice(i, i + EMBED_BATCH).map(targetText))));
    }
    await putRunJson(env, run.id, 'target_vectors', targetVecs.map((v) => v.map((x) => Math.round(x * 1e5) / 1e5)));
  }

  const candidates = (await getRunJson<Candidate[]>(env, run.id, 'candidates')) ?? [];
  const topSims = (await getRunJson<number[]>(env, run.id, 'top_sims')) ?? [];
  let cursor = run.cursor;
  while (cursor < sources.length && hasTime(b)) {
    const batch = sources.slice(cursor, cursor + embedBatchSize(sources.map((x) => x.text), cursor));
    b.subrequests--;
    const vecs = await embed(env.AI, batch.map((s) => s.text));
    const out = shortlistBatch(batch, vecs, pages, targetVecs, cfg);
    candidates.push(...out.candidates);
    topSims.push(...out.topSims);
    cursor += batch.length;
    progress.shortlisted = cursor;
    await b.onProgress?.();
  }
  await putRunJson(env, run.id, 'candidates', candidates);
  await putRunJson(env, run.id, 'top_sims', topSims);
  progress.candidates = candidates.length;
  const sorted = [...topSims].sort((a, x) => a - x);
  progress.top_sim_p10 = percentile(sorted, 0.1);
  progress.top_sim_p50 = percentile(sorted, 0.5);
  progress.top_sim_p90 = percentile(sorted, 0.9);

  if (cursor < sources.length) return { cursor };

  await deleteRunJson(env, run.id, ['sources', 'target_vectors', 'top_sims']);
  if (candidates.length === 0) {
    throw new RunFailure('No paragraph was similar enough to another page to suggest a link.');
  }
  const estimate = Math.round(estimateRunCost(candidates.length) * 10000) / 10000;
  const next = { stage: 'score' as RunStage, cursor: 0, total: candidates.length, estimated_cost_usd: estimate };
  // Cost gate: pause and ask before spending more than the run's limit.
  if (estimate > run.max_cost_usd) return { ...next, status: 'awaiting_confirmation' as RunStatus };
  return next;
}

async function stepScore(env: Env, run: RunRow, progress: RunProgress, b: Budget, apiKey: string) {
  const candidates = (await getRunJson<Candidate[]>(env, run.id, 'candidates'))!;
  const judgements = (await getRunJson<Array<JevResponse | null>>(env, run.id, 'judgements')) ?? [];
  let cursor = run.cursor;
  let cost = 0;
  try {
    while (cursor < candidates.length && hasTime(b, 14_000)) {
      const batch = candidates.slice(cursor, cursor + Math.min(JEV_CONCURRENCY, b.subrequests));
      b.subrequests -= batch.length;
      const results = await mapLimit(batch, JEV_CONCURRENCY, (c) => callJev(c, apiKey, { timeoutMs: 12_000, deadline: b.deadline - 2000 }));
      results.forEach((r, i) => {
        judgements[cursor + i] = r.answers ? { answers: r.answers, model: r.model, usage: r.usage } : {};
        cost += r.usage?.cost ?? 0;
        progress.tokens = (progress.tokens ?? 0) + (r.usage?.input_tokens ?? 0);
        if (r.model && !progress.jev_model) progress.jev_model = r.model;
        if (!r.answers) progress.api_errors = (progress.api_errors ?? 0) + 1;
      });
      cursor += batch.length;
      progress.judged = cursor;
      await b.onProgress?.();
    }
  } finally {
    await putRunJson(env, run.id, 'judgements', judgements);
    progress.judged = cursor;
  }
  if (cursor < candidates.length) return { cursor, addCost: cost };
  return { stage: 'allocate' as RunStage, cursor: 0, total: 0, addCost: cost };
}

async function stepAllocate(env: Env, run: RunRow, progress: RunProgress, cfg: InternalLinksConfig) {
  const candidates = (await getRunJson<Candidate[]>(env, run.id, 'candidates'))!;
  const judgements = (await getRunJson<Array<JevResponse | null>>(env, run.id, 'judgements'))!;
  const pages = (await getRunJson<CrawledPage[]>(env, run.id, 'pages'))!;
  const js: Judgement[] = candidates.map((c, i) => ({ candidate: c, response: judgements[i] ?? {} }));
  const result = allocate(js, pages.map((p) => p.inbound_links), cfg);
  await putRunJson(env, run.id, 'allocation', { chosen: result.chosen, capLog: result.capLog });
  progress.allocated = result.chosen.length;
  return { stage: 'anchors' as RunStage, cursor: 0, total: result.chosen.length };
}

async function stepAnchors(env: Env, run: RunRow, progress: RunProgress, b: Budget, apiKey: string) {
  const { chosen } = (await getRunJson<{ chosen: Allocation[] }>(env, run.id, 'allocation'))!;
  const pages = (await getRunJson<CrawledPage[]>(env, run.id, 'pages'))!;
  const byCanon = new Map(pages.map((p) => [p.canon, p]));
  const anchors = (await getRunJson<Array<string | null>>(env, run.id, 'anchors')) ?? [];
  let cursor = run.cursor;
  let cost = 0;
  try {
    while (cursor < chosen.length && hasTime(b, 14_000)) {
      const batch = chosen.slice(cursor, cursor + Math.min(ANCHOR_CONCURRENCY, b.subrequests));
      b.subrequests -= batch.length;
      const results = await mapLimit(batch, ANCHOR_CONCURRENCY, (link) => {
        const t = byCanon.get(link.target_canon);
        return writeAnchor(link, t?.description || t?.h1 || link.target_title, apiKey, {
          timeoutMs: 12_000,
          deadline: b.deadline - 2000,
        });
      });
      results.forEach((r, i) => {
        anchors[cursor + i] = r.anchor ?? '';
        cost += r.cost;
      });
      cursor += batch.length;
      progress.anchors_done = cursor;
      await b.onProgress?.();
    }
  } finally {
    await putRunJson(env, run.id, 'anchors', anchors);
    progress.anchored = anchors.filter(Boolean).length;
  }
  if (cursor < chosen.length) return { cursor, addCost: cost };
  return { stage: 'report' as RunStage, cursor: 0, total: 0, addCost: cost };
}

async function stepReport(env: Env, run: RunRow, progress: RunProgress, cfg: InternalLinksConfig) {
  const candidates = (await getRunJson<Candidate[]>(env, run.id, 'candidates'))!;
  const judgements = (await getRunJson<Array<JevResponse | null>>(env, run.id, 'judgements'))!;
  const pages = (await getRunJson<CrawledPage[]>(env, run.id, 'pages'))!;
  const { chosen, capLog } = (await getRunJson<{ chosen: Allocation[]; capLog: Record<string, CapReason> }>(
    env, run.id, 'allocation'
  ))!;
  const anchors = (await getRunJson<Array<string | null>>(env, run.id, 'anchors')) ?? [];
  const byCanon = new Map(pages.map((p) => [p.canon, p]));

  const links: LinkWithAnchor[] = [];
  chosen.forEach((link, i) => {
    const anchor = anchors[i];
    if (anchor) links.push(withAnchor(link, anchor, byCanon.get(link.target_canon) ?? {}));
  });
  const js: Judgement[] = candidates.map((c, i) => ({ candidate: c, response: judgements[i] ?? {} }));
  const rows = buildDecisionRows(js, chosen, links, capLog, cfg);
  const failed = (progress.pages_failed ?? 0);
  const report = buildReport({
    site: run.site_url,
    pages,
    failedPages: failed,
    rows,
    cfg,
    jevModel: progress.jev_model ?? JEV_MODEL,
    anchorModel: ANCHOR_MODEL,
    costUsd: run.cost_usd,
    tokens: progress.tokens ?? 0,
  });
  await putRunJson(env, run.id, 'report', report);
  const summary = {
    pages: report.summary.pages,
    decisions: report.summary.decisions,
    links: report.summary.links,
    apply: links.filter((l) => l.action === 'apply').length,
    review: links.filter((l) => l.action === 'review').length,
    orphans: pages.filter((p) => p.inbound_links === 0).length,
  };
  return { stage: 'done' as RunStage, status: 'completed' as RunStatus, summary };
}

// ---------------------------------------------------------------------------
// Slice driver

async function claim(env: Env, runId: string): Promise<RunRow | null> {
  return await env.DB.prepare(
    `UPDATE internal_link_runs
     SET processing_locked_until = datetime('now', '+${LOCK_SECONDS} seconds')
     WHERE id = ? AND status = 'running'
       AND (processing_locked_until IS NULL OR processing_locked_until < datetime('now'))
     RETURNING *`
  )
    .bind(runId)
    .first<RunRow>();
}

/**
 * Advance one run as far as the budget allows. Never throws. Returns false
 * when another slice already holds the run (or it is not running).
 */
export async function processRun(env: Env, runId: string, budget: Budget): Promise<boolean> {
  let run = await claim(env, runId);
  if (!run) return false;
  const progress: RunProgress = run.progress_json ? JSON.parse(run.progress_json) : {};
  const cfg = await getConfig(env);

  const save = async (fields: Record<string, unknown>) => {
    const cols = Object.keys(fields);
    await env.DB.prepare(
      `UPDATE internal_link_runs SET ${cols.map((c) => `${c} = ?`).join(', ')},
         progress_json = ?, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(...cols.map((c) => fields[c] as string | number | null), JSON.stringify(progress), runId)
      .run();
  };

  budget.onProgress = async () => {
    await env.DB.prepare(`UPDATE internal_link_runs SET progress_json = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(JSON.stringify(progress), runId)
      .run();
  };

  try {
    let apiKey: string | null = null;
    while (run.status === 'running' && run.stage !== 'done' && hasTime(budget)) {
      if ((run.stage === 'score' || run.stage === 'anchors') && !apiKey) {
        apiKey = await resolveUserOpenRouterKey(env, run.user_id);
        if (!apiKey) {
          throw new RunFailure('No saved OpenRouter key was found for your account. Add it in Settings, then resume the run.');
        }
      }
      let r: {
        stage?: RunStage; cursor?: number; total?: number; status?: RunStatus;
        addCost?: number; estimated_cost_usd?: number; summary?: unknown;
      };
      switch (run.stage) {
        case 'crawl': r = await stepCrawl(env, run, progress, budget, cfg); break;
        case 'shortlist': r = await stepShortlist(env, run, progress, budget, cfg); break;
        case 'score': r = await stepScore(env, run, progress, budget, apiKey!); break;
        case 'allocate': r = await stepAllocate(env, run, progress, cfg); break;
        case 'anchors': r = await stepAnchors(env, run, progress, budget, apiKey!); break;
        case 'report': r = await stepReport(env, run, progress, cfg); break;
        default: r = {};
      }
      const fields: Record<string, unknown> = {};
      if (r.stage !== undefined) fields.stage = r.stage;
      if (r.cursor !== undefined) fields.cursor = r.cursor;
      if (r.total !== undefined) fields.total = r.total;
      if (r.status !== undefined) fields.status = r.status;
      if (r.estimated_cost_usd !== undefined) fields.estimated_cost_usd = r.estimated_cost_usd;
      if (r.addCost) fields.cost_usd = run.cost_usd + r.addCost;
      if (r.summary !== undefined) {
        fields.summary_json = JSON.stringify(r.summary);
        fields.completed_at = new Date().toISOString();
      }
      if (Object.keys(fields).length) await save(fields);
      run = { ...run, ...(fields as Partial<RunRow>) };
    }
  } catch (err) {
    const message =
      err instanceof RunFailure || err instanceof JevAuthError
        ? err.message
        : `Something went wrong while processing the run: ${err instanceof Error ? err.message : String(err)}`;
    console.error('[internal-links] run failed', runId, run.stage, err);
    await save({ status: 'failed', error: message });
  } finally {
    await env.DB.prepare('UPDATE internal_link_runs SET processing_locked_until = NULL WHERE id = ?').bind(runId).run();
  }
  return true;
}

/**
 * Cron backstop: advance runs nobody is watching (a page being polled keeps
 * updated_at fresh). Small subrequest budget: it shares the every-5-minutes
 * cron invocation with the GSC sync slice.
 */
export async function processInternalLinkRuns(env: Env, deadline: number): Promise<number> {
  if (await env.KV.get('internal-links-paused')) return 0;
  const { results } = await env.DB.prepare(
    `SELECT id FROM internal_link_runs
     WHERE status = 'running'
       AND (processing_locked_until IS NULL OR processing_locked_until < datetime('now'))
       AND updated_at < datetime('now', '-2 minutes')
     ORDER BY updated_at ASC LIMIT 2`
  ).all<{ id: string }>();
  let n = 0;
  for (const { id } of results ?? []) {
    if (Date.now() > deadline - 10_000) break;
    await processRun(env, id, { deadline, subrequests: 120 });
    n++;
  }
  return n;
}

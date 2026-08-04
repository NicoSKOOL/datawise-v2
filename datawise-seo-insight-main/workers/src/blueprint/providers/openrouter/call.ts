import type { Env } from '../../../index';
import type { StageContext } from '../../orchestration/handlers';
import type { ChatMessage, LLMProvider } from '../../../llm/provider';
import { getLLMProvider } from '../../../llm/provider';
import { chatCompleteEscalating } from '../../../llm/length-escalation';
import { reserveProviderBudget, reconcileProviderBudget, releaseProviderBudget } from '../../db/budget';
import { newId, nowIso } from '../../db/util';

// The single choke point every paid OpenRouter (LLM) call inside a blueprint
// run goes through, mirroring providers/dataforseo/call.ts's
// reserve -> call -> reconcile -> usage-row choreography but without the
// KV/R2/evidence bookkeeping (an LLM classification produces no cacheable
// artifact). Budget is reserved BEFORE the call against the run's openrouter
// ceiling, released on failure, and reconciled to a flat conservative actual
// after. No other blueprint module may call an LLM against a run's budget
// directly.

export interface OpenRouterCallSpec {
  messages: ChatMessage[];
  model: string;
  // provider_usage.operation + budget operationKey suffix, e.g. 'cluster_adjudication'.
  operation: string;
  // Disambiguates repeated operations within one stage attempt (e.g. batch index).
  scopeId: string;
  // Reserved before the call and reconciled as the actual after (flat: we have
  // no per-token price table for OpenRouter).
  estimateUsdMicro: number;
  startTokens: number;
  ceilingTokens: number;
  // Truncation-log route tag for chatCompleteEscalating.
  label: string;
  // The run creator's own OpenRouter key (providers/openrouter/byok.ts).
  // Required in production: this module refuses to call without it rather than
  // let member inference spend fall back to a platform-managed key. Only the
  // env.BLUEPRINT_LLM test seam may stand in for it.
  apiKey?: string;
  responseFormat?: 'json';
  temperature?: number;
}

export interface OpenRouterCallResult {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
  finishReason?: string;
  costUsdMicro: number;
}

async function releaseQuietly(d1: D1Database, reservationId: string): Promise<void> {
  try {
    await releaseProviderBudget(d1, reservationId);
  } catch (releaseErr) {
    console.error(`blueprintOpenRouterCall: release failed for reservation ${reservationId}:`, releaseErr);
  }
}

export async function blueprintOpenRouterCall(
  ctx: StageContext,
  spec: OpenRouterCallSpec
): Promise<OpenRouterCallResult> {
  const { d1, env, runId } = ctx;

  // BYOK gate, before any budget is reserved: no member key (and no scripted
  // test provider) means we do not call at all. Callers resolve the key once
  // per stage and skip gracefully; reaching here without one is a programming
  // error, and failing loud is the only way this stays impossible to bill to
  // the platform's account by accident.
  if (!env.BLUEPRINT_LLM && !spec.apiKey) {
    throw new Error(
      'blueprintOpenRouterCall: no member OpenRouter key for this run (BYOK required, no server-key fallback)'
    );
  }

  // Reserve first. Attempt-scoped operation key so a retry after a released
  // reservation reserves fresh instead of colliding with the prior attempt's
  // terminal reservation row (same convention as blueprintDfsCall).
  const reservation = await reserveProviderBudget(
    d1,
    runId,
    'openrouter',
    spec.estimateUsdMicro,
    `${spec.operation}:${spec.scopeId}:a${ctx.attempt}`
  );

  // Test seam: env.BLUEPRINT_LLM is a scripted provider in unit tests; production
  // resolves the real OpenRouter adapter against the member's own key, which
  // getLLMProvider prefers over any env-managed key (llm/provider.ts).
  const config = {
    provider: 'openrouter' as const,
    model: spec.model,
    ...(spec.apiKey ? { api_key: spec.apiKey } : {}),
  };
  const provider: LLMProvider = env.BLUEPRINT_LLM ?? getLLMProvider(env as unknown as Env, config);

  const startedAt = Date.now();
  let result;
  try {
    result = await chatCompleteEscalating(provider, spec.messages, env as unknown as Env, config, {
      startTokens: spec.startTokens,
      ceilingTokens: spec.ceilingTokens,
      label: spec.label,
      ...(spec.responseFormat ? { responseFormat: spec.responseFormat } : {}),
      ...(typeof spec.temperature === 'number' ? { temperature: spec.temperature } : {}),
    });
  } catch (err) {
    await releaseQuietly(d1, reservation.reservationId);
    throw err;
  }
  const latencyMs = Date.now() - startedAt;

  // Flat conservative actual (see OPENROUTER_ADJUDICATION_CALL_USD_MICRO): the
  // provider genuinely ran, so reconcile the estimate rather than release it.
  const costUsdMicro = spec.estimateUsdMicro;

  await d1
    .prepare(
      `INSERT INTO provider_usage
        (id, run_id, stage, provider, operation, endpoint_or_model, provider_task_ids_json,
         cache_status, request_count, returned_item_count, prompt_tokens, completion_tokens,
         finish_reason, cost_usd_micro, latency_ms, created_at)
       VALUES (?, ?, ?, 'openrouter', ?, ?, '[]', 'miss', 1, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      newId('pu'),
      runId,
      ctx.stage,
      spec.operation,
      spec.model,
      result.text.length,
      result.usage.input_tokens,
      result.usage.output_tokens,
      result.finishReason ?? null,
      costUsdMicro,
      latencyMs,
      nowIso()
    )
    .run();

  await reconcileProviderBudget(d1, reservation.reservationId, costUsdMicro);

  return {
    text: result.text,
    usage: result.usage,
    ...(result.finishReason ? { finishReason: result.finishReason } : {}),
    costUsdMicro,
  };
}

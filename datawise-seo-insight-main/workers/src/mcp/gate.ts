import type { ToolDef, ToolContext } from './tools/types';
import { checkAccess, denialMessage } from './access';
import { checkRateLimit, estimateCostUsd, checkBudget, budgetMessage, recordUsage } from './budget';
import { toolError, type ToolResult } from './shape';
import { DataForSeoQuotaError, type DfsMeter } from '../dataforseo/client';
import { HandlerError } from './call-handler';

const RATE_MESSAGE = 'Rate limit: 30 tool calls per minute per account. Wait a moment and retry.';
const QUOTA_MESSAGE = 'DataForSEO daily quota is exhausted for today, so live data tools are unavailable until 00:00 UTC. Rank tracking, AI visibility and Search Console tools still work.';

// Spec 6.2 gate order: kill switch, membership, allowlist (all in checkAccess),
// per-minute rate, input validation, budget pre-check, run, ledger.
export async function runGated(tool: ToolDef, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const { env, identity } = ctx;

  const denial = await checkAccess(env, identity);
  if (denial) return toolError(denialMessage(denial));
  if (!(await checkRateLimit(env, identity.userId))) return toolError(RATE_MESSAGE);

  const parsed = tool.inputSchema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return toolError(`Invalid input for ${tool.name}: ${issues}`);
  }
  const args = parsed.data as Record<string, unknown>;

  const budget = await checkBudget(env, identity, estimateCostUsd(tool.name, args));
  if (!budget.ok) return toolError(budgetMessage(budget));

  const meter: DfsMeter = { costUsd: 0, liveCalls: 0, cacheHits: 0 };
  const meteredEnv = { ...env, dfsMeter: meter };
  const started = Date.now();
  let result: ToolResult;
  let ok = true;
  try {
    result = await tool.run(args, { env: meteredEnv, identity });
    ok = !result.isError;
  } catch (err) {
    ok = false;
    if (err instanceof DataForSeoQuotaError) {
      result = toolError(QUOTA_MESSAGE);
    } else if (err instanceof HandlerError) {
      result = toolError(err.message);
    } else {
      console.error(`[mcp] ${tool.name} failed for user ${identity.userId}:`, err);
      result = toolError(`${tool.name} failed unexpectedly. Try again in a minute; if it keeps failing, report it from DataWise Settings.`);
    }
  }

  try {
    await recordUsage(env, {
      userId: identity.userId,
      tool: tool.name,
      costUsd: meter.costUsd,
      cached: meter.liveCalls === 0 && meter.cacheHits > 0,
      ok,
      durationMs: Date.now() - started,
      authKind: identity.authKind,
      clientName: identity.tokenName,
    });
  } catch (err) {
    console.error('[mcp] recordUsage failed:', err);
  }
  return result;
}

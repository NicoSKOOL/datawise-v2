import { BlueprintApiError, NotFoundError } from '../domain/api-errors';
import { processResearchRun } from './process-run';
import type { BlueprintQueueEnv, ProcessRunResult } from './process-run';
import type { RunStatus } from '../contracts/enums';

// Binding contract (Task 8 review): the crash-recovery model depends on the
// consumer acking a message ONLY AFTER processResearchRun resolves. A message
// that throws must be retried (message.retry()) so Cloudflare Queues
// redelivery is what drives resuming a stuck run after an unexpected error.
//
// Two error shapes are acked instead of retried, because retrying cannot
// help either:
//   - NotFoundError: the runId in the message body doesn't exist (poison
//     message; the run was deleted/never existed).
//   - BlueprintApiError('stage_conflict'): another worker already owns the
//     stage lease this message was for; that owner is responsible for
//     re-enqueuing the next step, so redelivering this message would just
//     race it forever.
// Every other throw (D1 blips, provider errors that escaped the stage
// handler's own retry_wait handling, bugs) is retried up to max_retries,
// after which Cloudflare Queues routes the message to the DLQ.
//
// Invalid/malformed message bodies are also acked (poison messages): no
// processResearchRun call can be attempted without a runId to act on.
//
// A resolved (non-throwing) result that is NOT terminal still needs a
// production driver to eventually get re-invoked: either the run is parked
// waiting on a future next_retry_at (result.waitUntil), or this invocation
// made no progress at all (result.advanced === false, e.g. another worker
// currently holds the stage lease). Both cases ack the current message (it
// was handled, nothing to retry) and schedule a delayed re-send of the same
// { runId } body. Delayed sends are used instead of message.retry() so the
// queue's max_retries budget stays reserved for real errors, and so both
// expired-lease recovery and retry_wait wake-ups have a production driver
// instead of depending on the admin UI's client-side poll to ever come back.

interface QueueMessageBody {
  runId: string;
}

function parseMessageBody(body: unknown): QueueMessageBody | null {
  if (typeof body !== 'object' || body === null) return null;
  const runId = (body as Record<string, unknown>).runId;
  if (typeof runId !== 'string' || runId.length === 0) return null;
  return { runId };
}

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'cancelled', 'partial']);

const MIN_WAKEUP_DELAY_SECONDS = 5;
const MAX_WAKEUP_DELAY_SECONDS = 300;
const DEFAULT_WAKEUP_DELAY_SECONDS = 60;

// Turns a process() result's optional waitUntil ISO timestamp into a delay
// (in seconds) for the wake-up message, clamped to a sane range. Falls back
// to the default delay when waitUntil is absent, unparsable, or already in
// the past (Math.ceil of a non-positive/NaN value is falsy, so `|| DEFAULT`
// catches all three).
export function computeWakeupDelaySeconds(waitUntil?: string): number {
  const parsed = waitUntil ? Date.parse(waitUntil) : NaN;
  const secondsUntil = Number.isNaN(parsed) ? NaN : Math.ceil((parsed - Date.now()) / 1000);
  const raw = secondsUntil || DEFAULT_WAKEUP_DELAY_SECONDS;
  return Math.min(MAX_WAKEUP_DELAY_SECONDS, Math.max(MIN_WAKEUP_DELAY_SECONDS, raw));
}

export interface HandleBlueprintQueueBatchDeps {
  process?: typeof processResearchRun;
}

export async function handleBlueprintQueueBatch(
  batch: MessageBatch<unknown>,
  env: BlueprintQueueEnv,
  deps?: HandleBlueprintQueueBatchDeps
): Promise<void> {
  const process = deps?.process ?? processResearchRun;

  for (const message of batch.messages) {
    const parsed = parseMessageBody(message.body);
    if (!parsed) {
      console.error('Blueprint queue: dropping poison message with invalid body', message.body);
      message.ack();
      continue;
    }

    // shouldRetry decides ack vs retry AFTER the try/catch below (instead of
    // acking/retrying from inside it) so that a throw from message.ack()
    // itself can never fall into the catch block and trigger message.retry()
    // as well, which would double-deliver.
    let shouldRetry = false;

    try {
      const workerId = crypto.randomUUID();
      const result: ProcessRunResult = await process(env, parsed.runId, workerId);

      if (!TERMINAL_RUN_STATUSES.has(result.runStatus) && (result.waitUntil || result.advanced === false)) {
        const delaySeconds = computeWakeupDelaySeconds(result.waitUntil);
        await env.BLUEPRINT_QUEUE.send({ runId: parsed.runId }, { delaySeconds });
      }
      // Otherwise: either the run reached a terminal status (nothing left to
      // drive), or it advanced to a non-terminal state without a waitUntil,
      // meaning processResearchRun already enqueued the immediate next
      // stage itself. Either way, only an ack is needed here.
    } catch (err) {
      if (err instanceof NotFoundError || (err instanceof BlueprintApiError && err.code === 'stage_conflict')) {
        console.error(
          `Blueprint queue: acking run ${parsed.runId} after unretryable error (${err.name}): ${err.message}`
        );
      } else {
        const message_ = err instanceof Error ? err.message : String(err);
        console.error(`Blueprint queue: retrying run ${parsed.runId} after error: ${message_}`);
        shouldRetry = true;
      }
    }

    if (shouldRetry) {
      message.retry();
    } else {
      message.ack();
    }
  }
}

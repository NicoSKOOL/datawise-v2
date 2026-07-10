import { BlueprintApiError, NotFoundError } from '../domain/api-errors';
import { processResearchRun } from './process-run';
import type { BlueprintQueueEnv } from './process-run';

// Binding contract (Task 8 review): the crash-recovery model depends on the
// consumer acking a message ONLY AFTER processResearchRun resolves. A message
// that throws must be retried (message.retry()) so Cloudflare Queues
// redelivery is what drives resuming a stuck run and waking it up after a
// retry_wait backoff, rather than any timer/poll this worker owns.
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

interface QueueMessageBody {
  runId: string;
}

function parseMessageBody(body: unknown): QueueMessageBody | null {
  if (typeof body !== 'object' || body === null) return null;
  const runId = (body as Record<string, unknown>).runId;
  if (typeof runId !== 'string' || runId.length === 0) return null;
  return { runId };
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

    const workerId = crypto.randomUUID();

    try {
      await process(env, parsed.runId, workerId);
      message.ack();
    } catch (err) {
      if (err instanceof NotFoundError || (err instanceof BlueprintApiError && err.code === 'stage_conflict')) {
        console.error(
          `Blueprint queue: acking run ${parsed.runId} after unretryable error (${err.name}): ${err.message}`
        );
        message.ack();
        continue;
      }
      const message_ = err instanceof Error ? err.message : String(err);
      console.error(`Blueprint queue: retrying run ${parsed.runId} after error: ${message_}`);
      message.retry();
    }
  }
}

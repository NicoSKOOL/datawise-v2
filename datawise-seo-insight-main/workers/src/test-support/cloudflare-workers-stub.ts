// Exists only so @cloudflare/workers-oauth-provider (which has a top-level
// `import { WorkerEntrypoint } from "cloudflare:workers"`) can load under
// vitest's node environment; runtime code never instantiates this class.
export class WorkerEntrypoint<Env = unknown, Props = unknown> {
  constructor(public ctx: ExecutionContext, public env: Env) {}
}

# Live Release Plan: OpenRouter + Content Writer Improvements

Date prepared: 2026-05-01
Branch: `codex-content-writer-prompt-admin`
Status: Plan only. Do not push or deploy until explicitly approved.

## Goal

Release the OpenRouter-only AI settings, curated model selector, Content Writer prompt/admin improvements, KB auto-draft flow, writer output fixes, and related UX changes to the live app without breaking existing users or losing D1 data.

## Release Scope

Include these workstreams:

- OpenRouter-only AI settings and curated model dropdown.
- Default model set to `deepseek/deepseek-v4-pro`.
- Search-grounded tasks locked to `perplexity/sonar-pro`.
- Content Writer prompt admin, prompt graph, placeholder rendering, and prompt persistence.
- Content Writer model compatibility fixes:
  - OpenRouter reasoning config.
  - GPT-5.5 Pro larger writer token budget.
  - Kimi K2.6 reasoning disabled for reliable visible output.
- Website KB auto-draft and context-aware discovery.
- Experience Notes chat UX improvements.
- Writer pipeline navigation/regeneration improvements.
- User rollout email and in-app notice copy.

Exclude:

- Unrelated marketing site changes.
- Unrelated dashboard/local SEO/backlinks/site audit work unless intentionally part of the release.
- Any batch modification of existing corrupted posts.

## Files To Review Before Staging

Core OpenRouter/model files:

- `datawise-seo-insight-main/src/lib/ai-models.ts`
- `datawise-seo-insight-main/src/lib/chat.ts`
- `datawise-seo-insight-main/src/lib/content-writer.ts`
- `datawise-seo-insight-main/src/pages/SettingsPage.tsx`
- `datawise-seo-insight-main/src/components/content-writer/ModelBadge.tsx`
- `datawise-seo-insight-main/workers/src/llm/openrouter-options.ts`
- `datawise-seo-insight-main/workers/src/llm/provider.ts`
- `datawise-seo-insight-main/workers/src/routes/content-writer.ts`

Prompt admin / Content Writer files from the wider feature:

- `datawise-seo-insight-main/src/pages/AdminContentWriterPrompts.tsx`
- `datawise-seo-insight-main/src/pages/ContentWriter.tsx`
- `datawise-seo-insight-main/src/lib/admin.ts`
- `datawise-seo-insight-main/workers/src/routes/admin-content-writer-prompts.ts`
- `datawise-seo-insight-main/workers/src/content-writer/prompts.ts`
- `datawise-seo-insight-main/workers/src/content-writer/prompt-registry.ts`
- `datawise-seo-insight-main/workers/src/content-writer/prompt-template.ts`
- `datawise-seo-insight-main/workers/src/content-writer/page-discovery.ts`
- `datawise-seo-insight-main/workers/src/content-writer/post-step-persistence.ts`

Tests and scripts:

- `datawise-seo-insight-main/scripts/test-ai-model-list.mjs`
- `datawise-seo-insight-main/workers/scripts/test-content-writer-helpers.mjs`
- `datawise-seo-insight-main/workers/scripts/test-content-writer-models.mjs`

D1 migrations to confirm/apply:

- `datawise-seo-insight-main/workers/migrations/2026-04-27-content-writer.sql`
- `datawise-seo-insight-main/workers/migrations/2026-04-27-content-writer-usage.sql`
- `datawise-seo-insight-main/workers/migrations/2026-04-30-content-writer-prompts.sql`

Communication:

- `tasks/openrouter-rollout-email-2026-05-01.md`

## Preflight Checklist

1. Confirm there are no uncommitted unrelated files in the release set.

   ```bash
   cd "/Users/nicolasgorrono/Desktop/DataWise V2/datawise-seo-insight-main"
   git status --short
   ```

2. Create a release branch or continue the current branch only if it contains the intended work.

   ```bash
   git branch --show-current
   ```

3. Review the diff by feature area before staging.

   ```bash
   git diff -- src/lib/ai-models.ts src/lib/chat.ts src/lib/content-writer.ts src/pages/SettingsPage.tsx src/components/content-writer/ModelBadge.tsx
   git diff -- workers/src/llm/openrouter-options.ts workers/src/llm/provider.ts workers/src/routes/content-writer.ts
   git diff -- workers/src/routes/admin-content-writer-prompts.ts workers/src/content-writer workers/migrations
   ```

4. Confirm no secrets are committed.

   ```bash
   git diff --check
   rg "sk-or-|sk-proj-|OPENROUTER_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY" .
   ```

   Expected: no real keys in tracked source files. Test output under `tmp/` should not be staged.

5. Delete or ignore local generated test artifacts before staging.

   ```bash
   git status --short tmp
   ```

   Expected: `tmp/content-writer-model-tests/**` remains untracked and unstaged.

## Verification Before Any Push

Run from `datawise-seo-insight-main`:

```bash
node scripts/test-ai-model-list.mjs
node workers/scripts/test-content-writer-helpers.mjs
node workers/scripts/test-content-writer-models.mjs --dry-run
npx tsc -p workers/tsconfig.json --noEmit
npm run build
```

Expected:

- Model list test passes with exactly 9 approved writer models.
- Content Writer helper tests pass.
- Model dry run lists the 9 approved models and no Gemma/Google writer models.
- Worker TypeScript passes.
- Vite build completes. Existing chunk-size warning is acceptable.

Optional but recommended before production:

```bash
OPENROUTER_API_KEY="<temporary-test-key>" node workers/scripts/test-content-writer-models.mjs \
  --post=e624d53a70174293acff5161077d88ab \
  --models=deepseek/deepseek-v4-pro,moonshotai/kimi-k2.6,openai/gpt-5.5-pro \
  --timeout=360000 \
  --outline-max-tokens=12000 \
  --draft-max-tokens=16000
```

Expected:

- DeepSeek V4 Pro passes.
- Kimi K2.6 passes.
- GPT-5.5 Pro passes, but may be slow.

## D1 Migration Plan

Do not run a blind full production schema migration first. Confirm the current production schema and apply only missing migrations.

1. Check Cloudflare auth.

   ```bash
   cd "/Users/nicolasgorrono/Desktop/DataWise V2/datawise-seo-insight-main/workers"
   npx wrangler whoami
   ```

2. Check whether Content Writer tables exist in production.

   ```bash
   npx wrangler d1 execute datawise-db-prod --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('content_writer_workspaces','content_writer_kb_docs','content_writer_posts','content_writer_prompt_configs','content_writer_prompt_versions');"
   ```

3. Check whether `usage_json` exists.

   ```bash
   npx wrangler d1 execute datawise-db-prod --remote --command "PRAGMA table_info(content_writer_posts);"
   ```

4. If Content Writer tables are missing, apply:

   ```bash
   npx wrangler d1 execute datawise-db-prod --remote --file=migrations/2026-04-27-content-writer.sql
   ```

5. If `content_writer_posts.usage_json` is missing, apply:

   ```bash
   npx wrangler d1 execute datawise-db-prod --remote --file=migrations/2026-04-27-content-writer-usage.sql
   ```

6. If prompt tables are missing, apply:

   ```bash
   npx wrangler d1 execute datawise-db-prod --remote --file=migrations/2026-04-30-content-writer-prompts.sql
   ```

7. Re-run the schema checks from steps 2 and 3.

Expected:

- `content_writer_prompt_configs` exists.
- `content_writer_prompt_versions` exists.
- `content_writer_posts` has `usage_json`.

## Staging Plan

1. Build the frontend locally.

   ```bash
   cd "/Users/nicolasgorrono/Desktop/DataWise V2/datawise-seo-insight-main"
   npm run build
   ```

2. Deploy Worker to staging first.

   ```bash
   cd workers
   npm run deploy:staging
   ```

3. Apply staging D1 migrations if staging is missing tables/columns, using the same migration checks above with `datawise-db-staging`.

4. Deploy frontend to the staging/preview target used by the app host.

   The root `package.json` does not define a frontend deploy script. Use the current hosting workflow for the app frontend, likely one of:

   - Cloudflare Pages dashboard/Git deploy from the release branch.
   - Existing Pages project deploy command, if configured outside this repo.
   - The host provider's manual deploy flow using the built `dist/` directory.

5. Smoke test staging:

   - Settings page loads.
   - OpenRouter key field saves.
   - Model dropdown shows 9 approved models grouped by provider.
   - DeepSeek V4 Pro is the default.
   - SEO Assistant sends a message successfully with the selected model.
   - Content Writer workspace loads.
   - KB auto-draft can start and returns drafts.
   - Experience Notes chat shows readable user bubbles and finish CTA.
   - Writer post research step uses Sonar Pro and returns source candidates.
   - Writer outline/draft/review use selected writer model.
   - Admin Writer Prompts page loads for admin users and returns `403` for non-admin users.

## Production Deploy Plan

Only proceed after staging smoke tests pass.

1. Make a release commit with scoped files only.

   ```bash
   git add \
     src/lib/ai-models.ts \
     src/lib/chat.ts \
     src/lib/content-writer.ts \
     src/pages/SettingsPage.tsx \
     src/components/content-writer/ModelBadge.tsx \
     workers/src/llm/openrouter-options.ts \
     workers/src/llm/provider.ts \
     workers/src/routes/content-writer.ts \
     workers/src/routes/admin-content-writer-prompts.ts \
     workers/src/content-writer \
     workers/scripts/test-content-writer-helpers.mjs \
     workers/scripts/test-content-writer-models.mjs \
     scripts/test-ai-model-list.mjs \
     workers/migrations/2026-04-27-content-writer.sql \
     workers/migrations/2026-04-27-content-writer-usage.sql \
     workers/migrations/2026-04-30-content-writer-prompts.sql \
     ../tasks/openrouter-rollout-email-2026-05-01.md
   git commit -m "feat: add OpenRouter model routing and content writer controls"
   ```

2. Push the release branch.

   ```bash
   git push origin codex-content-writer-prompt-admin
   ```

3. Open a PR and review the final diff.

4. Apply production D1 migrations after DB schema preflight and before the Worker deploy if the current Worker expects the new tables.

5. Deploy Worker production.

   ```bash
   cd workers
   npm run deploy:production
   ```

6. Deploy frontend production through the current app hosting flow.

7. Confirm production environment variables/secrets:

   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `ENCRYPTION_KEY`
   - `DATAFORSEO_EMAIL`
   - `DATAFORSEO_PASSWORD`
   - `RESEND_API_KEY` if email flows are live
   - `OPENROUTER_API_KEY` may remain for local/dev fallback, but production user-facing AI should require the user's own OpenRouter key.

8. Production smoke tests:

   - Log in as a normal user.
   - Visit `/settings`, add an OpenRouter key, save settings.
   - Visit `/seo-assistant`, send one short prompt.
   - Visit `/content-writer`, open a workspace.
   - Run a lightweight writer step or preview if possible.
   - Log in as admin and visit `/admin/content-writer-prompts`.
   - Confirm non-admin access is denied.

## User Communication Timing

Recommended order:

1. Deploy backend + frontend.
2. Confirm production smoke tests.
3. Add tutorial link to `tasks/openrouter-rollout-email-2026-05-01.md`.
4. Send email to users.
5. Add or enable the short in-app notice.

Do not send the email before production is verified, because users will immediately try to add an OpenRouter key.

## Rollback Plan

If production breaks before users create new prompt configs:

1. Revert the frontend deployment to the previous successful build.
2. Revert Worker deployment to the previous Worker version from Cloudflare dashboard or redeploy the previous commit.
3. Leave D1 migrations in place if they only added tables/columns. Do not drop tables in rollback.

If prompt tables exist but the UI/API fails:

1. Disable the admin prompt route from frontend navigation first.
2. Keep generated prompt rows intact.
3. Patch Worker route or frontend UI and redeploy.

If OpenRouter model calls fail broadly:

1. Confirm users have valid OpenRouter keys.
2. Temporarily restrict the selector to `deepseek/deepseek-v4-pro` and `anthropic/claude-sonnet-4.6`.
3. Keep research locked to `perplexity/sonar-pro`.

## Final Go/No-Go Criteria

Go only if:

- All verification commands pass.
- No real API keys appear in `git diff`.
- Production D1 schema has required Content Writer tables and columns.
- Staging smoke tests pass.
- Production deploy target and rollback path are confirmed.
- Tutorial link is ready for the email.

No-go if:

- `npm run build` fails.
- Worker TypeScript fails.
- Prompt admin tables are missing and migration cannot be applied safely.
- SEO Assistant cannot complete a basic OpenRouter request.
- Content Writer research cannot return source candidates.

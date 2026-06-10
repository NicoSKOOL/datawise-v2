# DEPLOY.md — Production deploy rules for DataWise

**READ THIS BEFORE ANY DEPLOY. Especially Claude/Codex/AI agents.**

## The one rule that matters

> The `production` branch is the live site. Every change goes through a PR into `production`, gets merged, and is deployed using **only** `npm run deploy:pages:production` from a clean checkout of `production`. Never run raw `wrangler pages deploy` against this project.

Why: `npm run deploy:pages:production` runs the guard in `datawise-seo-insight-main/scripts/deploy-pages-production.mjs`, which refuses to deploy if the built bundle is missing critical features (Content Writer, AI Visibility, Brand Tracker, People Also Ask, Fan-out Queries, Content Planner, Content Tools, the indexation chart, the keyword metric badges, etc.) or if the current branch is not `production`. Raw `wrangler pages deploy` bypasses every one of those checks and will ship broken builds.

## Branch model

- **`production`** = trunk. What's live at `datawiseseo.com`.
- **`main`** = legacy, stale. Do not use.
- **Feature branches**: any name, branched off `production`, merged back into `production` via PR.

## Workflow for every change (including small fixes)

Promotion order is mandatory:

1. Build/test locally.
2. Deploy and verify a Cloudflare Pages preview/staging URL.
3. Deploy production last.

Never use `datawiseseo.com` as the first test target. If there is no preview/staging URL for the change, stop and create one before production deploy.

```sh
# 1. Sync with live
cd "/Users/nicolasgorrono/Desktop/DataWise V2"
git fetch origin
git checkout production
git pull origin production

# 2. Branch
git checkout -b fix/short-description    # or feat/short-description

# 3. Edit + test locally
cd datawise-seo-insight-main
npm run dev   # frontend on :8080

# 4. Commit + push
git add <specific files, no `git add .`>
git commit -m "fix: …"
git push -u origin fix/short-description

# 5. Open PR on GitHub: base = production, compare = fix/...
#    Review the diff carefully. If files you didn't change are in the diff, STOP.

# 6. Deploy/verify preview or staging.
#    Use the PR/feature preview URL or a staging Pages deployment.
#    Verify the actual user flows touched by the change before merge.

# 7. Merge PR (squash or merge — either is fine)

# 8. Deploy production last
git checkout production
git pull origin production
cd datawise-seo-insight-main
npm run deploy:pages:production
# This script:
#   - asserts current branch == production
#   - builds with the production VITE_API_URL
#   - greps the built bundle for required feature markers
#   - aborts if anything critical is missing
#   - only then uploads via wrangler

# 9. Tag the deploy
cd "/Users/nicolasgorrono/Desktop/DataWise V2"
TS=$(date -u +%Y-%m-%d-%H%M)
git tag -a "prod-$TS" -m "deploy"
git push origin --tags
```

## Worker (API) deploys

The Worker is a separate codebase in `datawise-seo-insight-main/workers/`. Worker deploys are independent of the SPA:

```sh
cd datawise-seo-insight-main/workers
npm run deploy     # → wrangler deploy → datawise-api (no env flag)
```

DO NOT use `npm run deploy:production` for the worker — see `~/.claude/projects/-Users-nicolasgorrono-Desktop-DataWise-V2/memory/reference_deployment.md` for the naming trap (creates an orphan `datawise-api-production` worker).

## Rollback (Pages)

If a deploy goes wrong, rollback via Cloudflare API (wrangler CLI does not support Pages rollback):

```sh
# 1. List recent deployments to pick the one to restore
cd datawise-seo-insight-main
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
  npx wrangler pages deployment list --project-name=datawise | head -10

# 2. Rollback to that deployment id
DEPLOYMENT_ID=<paste-id-here>
CF_TOKEN=$(grep -E "^oauth_token|^api_token" ~/Library/Preferences/.wrangler/config/default.toml | head -1 | cut -d'"' -f2)
curl -X POST \
  "https://api.cloudflare.com/client/v4/accounts/510d0ac03a3a8f5ebeac39be4926ed77/pages/projects/datawise/deployments/$DEPLOYMENT_ID/rollback" \
  -H "Authorization: Bearer $CF_TOKEN" \
  -H "Content-Type: application/json"
```

Then verify by curling `https://datawiseseo.com/` and checking the `assets/index-XXXX.js` filename matches the deployment you rolled back to.

Named recovery tags (use `git checkout <tag>` to restore source state):

- `prod-2026-05-13-2327-live` — last known-good live state before the 2026-05-14 incident.
- `prod-2026-05-21-1435` — after worker+SPA: typed `DataForSeoQuotaError` + 503 friendly message for `provider_quota_exhausted` (Bob's rank-tracking 402).
- `prod-2026-05-21-1504` — after worker-only perf pass: caching on keywords/competitors/rank-tracking/local-seo DFS calls, cron `*/2 → */5`, KV short-circuit on DFS 402. Worker version `012530e8`.
- `prod-2026-05-21-1552` — Brand Tracker per-platform split (fixes imregabri's `e0c73d59` concurrency bug); AI Visibility tabs trimmed to AI Search Tracker + Brand Tracker (removed duplicate People Also Ask + orphan On-Page SEO). Merge commit `96205a4`, PR #16. SPA-only; rollback via `git revert 96205a4 && git push origin production`.
- `prod-2026-05-27-1228` — OpenRouter preflight follow-ups: worker returns 400 (not 401) when key is invalid so SPA's auth interceptor stops force-logging users out (bug `7b7e46d1`); SPA `getLLMConfig()` tolerates legacy stored provider when api_key starts with `sk-or-`, SettingsPage auto-purges stale legacy config (bug `663ce49c`). Merge commit `5950c57`, PR #25. Worker version `fa2c7495`. Rollback both: `git revert 5950c57 && git push origin production` AND `wrangler rollback --message "openrouter preflight regression" 012530e8`.
- `prod-2026-05-27-1307` — GSC cluster 1: atomic `env.DB.batch` disconnect (bug `f83f0ecd`), refuse OAuth callback with empty `refresh_token` (the source of orphan-connection state), `refresh_failed_at` tracking, SPA reconnect/cleanup banner. New D1 column `gsc_connections.refresh_failed_at` (additive, already applied). Merge commit `8271103`, PR #26. Worker version `64ae2d0e`. Rollback both: `git revert 8271103 && git push origin production` AND `wrangler rollback --message "gsc cluster 1 regression" fa2c7495`. The D1 column is safe to leave in place even after rollback (old code ignores it).
- `prod-2026-05-27-1324` — SPA-only UX cluster: usePersistentState hook persists keyword research + Brand Tracker query inputs/results across navigation (bug `252b2580`); Content Writer empty-interview "Start interview" button (bug `44aba545`); Top Pages tile URL clipping with flex+min-w-0+truncate (bugs `bac2d060`, `dc9af2b2`). Merge commit `7ca0bcc`, PR #27. SPA-only; rollback via `git revert 7ca0bcc && git push origin production`. localStorage keys under `datawise:page-state:v1:*` are versioned for forward-compat.
- `prod-2026-05-27-1352` — Meta Checker apostrophe truncation: the `content="…"` regex used character classes on both sides, so any value containing `'` was clipped at the first apostrophe (Kendrick / dcroofingarizona.com: 158-char description read as 16-char "Extend your roof"). Switched to backreference `(["'])(...)\1` in `meta-checker.ts` `extractMetaDescription` + `extractMetaKeywords` + their `name|property` sub-extractors. Worker-only. Merge commit `a01828c`, PR #28. Worker version `fd479d13`. Rollback both: `git revert a01828c && git push origin production` AND `wrangler rollback --message "meta-checker apostrophe fix regression" 64ae2d0e`.
- `prod-2026-05-27-1737` — Bug batch 4 (SPA-only). Competitor Analysis tabs (Domain Rank, Ranked Keywords, Gap Analysis, Traffic, Competitors) now persist inputs + results via usePersistentState so tab switches no longer wipe state (bug `6e758797`). SEO Assistant reads its GSC property from PropertyContext and the in-page selector is now a read-only indicator, eliminating the two-selector confusion (bug `89b32130`). Brand Tracker free-text filter widened to match across question + answer + source titles/domains/snippets, fixing multi-word queries returning empty (bug `2119ccb9`). Merge commit `1e0ef5d`, PR #29. SPA-only; rollback via `git revert 1e0ef5d && git push origin production`.
- `prod-2026-05-27-1849` — Content Writer connection-drop recovery (SPA-only). When Research/Outline/Draft worker calls run long (60-120s) an intermediary (CF edge, proxy, dropped wifi) can close the connection while the worker keeps running and persists the output. The browser surfaced this as a generic "Failed to fetch" TypeError and the user was stranded. `runStep` now catches network drops, waits 8s, refetches the post, and if the step output is saved silently treats the click as success; otherwise it shows a friendlier "connection dropped, click again" message instead of "Failed to fetch". Fixes bug `0ac02a93` (Jon Petruch). Merge commit `a16b81e`, PR #31. SPA-only; rollback via `git revert a16b81e && git push origin production`.
- `prod-2026-06-03-1246` — Crawler UA + DFS false-negative fixes (worker-only). Customer sites behind WooCommerce/Cloudflare WAFs return 403 to our self-identifying `DataWiseBot/1.0` UA but 200 to a browser UA. Caused Meta Checker nil title/description and failed sitemap discovery (bug `7953e920`, bradsbikes.com.au) and Site Audit false "No robots.txt found" / "no sitemap" (bug `a9befa95`, resortstylebeanbags.com.au). Centralized a verified browser UA as `BROWSER_UA` in `safe-fetch.ts`, used it in `meta-checker.ts` + `content-tools.ts` sitemap discovery; added `clearRobotsSitemapFalseNegatives()` in the site-audit finalizer to re-verify robots.txt/sitemap with a browser UA before trusting a DFS "missing" verdict; reworded the schema-validation finding to point to Google Rich Results Test instead of validator.schema.org. Merge commit `6ee6596`, PR #40. Worker version `df7021dd`. Rollback: `wrangler rollback --message "crawler UA regression" 5193ad63` (worker is the only surface; no SPA change to revert).
- `prod-2026-06-03-1459` — People Also Ask hang fix (worker + SPA). PAA ran a sequential BFS of up to 10 (depth 2) / 25 (depth 3) DataForSEO `live/advanced` SERP calls awaited one at a time, taking 5+ minutes with only a spinner (bug `d45587d5`, info@nahiro.net). Fix: dispatch each BFS round as up to 6 single-task calls in parallel via `Promise.all` (NOT batched into one POST — DFS live/advanced only processes the first task in an array, the rest return status 40000 empty; verified against live DFS), and add `people_also_ask_click_depth: 4` so DFS expands the PAA accordion server-side (~12 questions/call vs ~4). Verified: "lapis lazuli" depth 3 → 50 unique questions in ~18s (was ~10 / multi-minute). SPA adds an elapsed-seconds progress counter. Merge commit `ee6ca5a`, PR #42. Worker version `9bed6b83`. Rollback both: `git revert ee6ca5a && git push origin production` AND `wrangler rollback --message "paa regression" df7021dd`.
- `prod-2026-06-03-2034` — Content Revival rewrite token-cap fix (worker-only). `handleRewritePost` capped LLM output at 4096 tokens while `REWRITE_PROMPT` asks for a full article (min 1,200 words) + FAQ. On reasoning models (deepseek-v4, gpt-5*) reasoning tokens are deducted from that budget, so the model could spend the cap and return only the opening `# title`, leaving a title with no body (bug, javier.barrezueta; worse in Spanish since output runs ~15-20% longer). Same failure mode already fixed for the Writer (`content-writer.ts` resolvePostStepMaxTokens, draft=16384) but never propagated to the rewriter. Fix: raise rewrite + language-retry cap to 16384; guard against silent empty/title-only output (return a clear 502 instead of a blank rewrite) and log when output hits the cap. Merge commit `c697331`, PR #44. Worker version `b11eb18a`. Rollback: `wrangler rollback --message "revival token cap regression" 9bed6b83` (worker only; no SPA change to revert).
- `prod-2026-06-10-1132` — GSC incremental sync (worker-only). `handleGSCSync` no longer wipes and reloads the full window per sync: converted properties (have `source='pd'` rows) refetch per-day rows only from 2 days before the newest stored pd date, delete only the rewritten row sets, trim pd at 35 days, and scheduled (cron) syncs reuse the agg90 aggregate for up to 7 days (`trigger:'scheduled'`; the manual Sync button stays fully fresh). First syncs / legacy properties keep the full wipe-and-reload path, which converts them. Kills the dominant D1 rows-written cost (~90% per-cron-sync cut measured on alignlending.com: 5,801 rows full vs ~600 incremental). Merge commit `6250c47`, PR #48. Worker version `46f5f88f`. NOTE: `46f5f88f` was built from `feat/ai-visibility-tracker` (PR #47, already live as `f31e4993`) plus this fix, because the live worker was ahead of `production` with the unmerged tracker. Rollback: `wrangler rollback --message "gsc incremental sync regression" f31e4993` (worker only; no SPA change to revert; `f31e4993` still contains the tracker).

- `prod-2026-06-10-1626` — Triple merge (worker + SPA): PR #47 AI Visibility Tracker (weekly Monday cron, kill switch `ai-tracking-paused`), PR #49 Rank Tracking wave 1 (scheduled SERP checks Tue/Thu/Sat 08:00 UTC with kill switch `rank-checks-paused` + 200 kw/run cap, single-task DFS fix so all keywords actually get checked, honest >100 misses, device column, window-function queries, Local Pack 5x parallel checks, single property selector, enriched project cards, debounce, pagination), PR #50 AI Visibility panel redesign (verdict strip, rule-based recommendations, cited-terms discovery tab via llm-mentions, answer_text storage + lazy endpoint, 20-query cap, Competitor Comparison card removed, vitest added to workers/ with 12 tests). Merge commits `032ac0a`-stack -> `d642f93` (#49) -> `68e5c93` (#50). Worker version `503007d5` (already live pre-merge; merges reconciled git with the deployed worker). D1 migrations applied: ai-visibility-tracking (2026-06-09), tracked_keywords.device, ai_visibility_checks.answer_text (all additive). Rollback: SPA via Pages rollback to the pre-merge deployment; worker `wrangler rollback --message "triple-merge regression" f31e4993` (pre-wave worker, still contains the tracker).

## Rollback (Worker, `datawise-api`)

The Worker is independent of Pages. To roll back:

```sh
# 1. List versions (most recent first)
cd datawise-seo-insight-main/workers
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
  npx wrangler deployments list | head -30

# 2. Roll back to a prior version id
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
  npx wrangler rollback --message "rollback reason" <version-id>
```

Last known-good worker versions:

- `e9ef6067` — 2026-05-17 baseline before the May 2026 changes.
- `316dc206` — added `DataForSeoQuotaError` typed 503 (2026-05-21).
- `012530e8` — caching + cron + quota short-circuit (2026-05-21).
- `fa2c7495` — OpenRouter preflight returns 400 (not 401) on invalid key, stops SPA forced logout (2026-05-27, PR #25).
- `64ae2d0e` — GSC cluster 1 — atomic disconnect, refuse empty refresh_token on OAuth callback, refresh_failed_at tracking, needs_reconnect/has_orphan_properties in /gsc/properties response, gsc_reauth_required code on 403s (2026-05-27, PR #26).
- `fd479d13` — current; Meta Checker apostrophe truncation fix — backreference regex for HTML attribute quote matching (2026-05-27, PR #28).

If a rollback reintroduces an old bug, also `git revert` the corresponding commit on `production` so the source matches the live worker. Otherwise the next deploy via CI re-ships the bad change.

## Roll back today's specific changes individually

If the caching layer specifically misbehaves (stale data complaints, KV cost spike), the smallest reversal is:

```sh
git revert 4a51176   # perf(workers): cache + cron + quota short-circuit
git push origin production
# CI rebuilds SPA (no-op), then run the worker deploy manually:
cd datawise-seo-insight-main/workers && npm run deploy
```

If the typed quota error layer misbehaves:

```sh
git revert 2d6cebb   # fix(rank-tracking): provider_quota_exhausted 503
git push origin production
cd datawise-seo-insight-main/workers && npm run deploy
```

If the marketing CL0 handler misbehaves:

```sh
git revert fbd10c2   # fix(marketing): ship Resend CL0 handler
git push origin production
# Then rebuild + redeploy datawise-marketing manually:
cd marketing && npm run build && npx wrangler pages deploy ./dist \
  --project-name=datawise-marketing --branch=main
```

## What NOT to do

- ❌ `wrangler pages deploy dist --project-name=datawise ...` from any branch. Use the npm script.
- ❌ Deploy from a feature branch.
- ❌ Deploy with a dirty working tree (`git status` must be clean).
- ❌ Deploy from `main` (it's stale).
- ❌ Deploy production before verifying a preview/staging URL.
- ❌ Use the live app as the first place to test a change.
- ❌ Skip the PR step "just for a one-liner". The PR diff is the only place you'll catch deleted files.
- ❌ Use `git add .` or `git add -A`. Only add the files you intended to change.

## What an AI agent (Claude/Codex) must do before deploying

1. Run `git rev-parse --abbrev-ref HEAD` → must be `production`.
2. Run `git status --porcelain` → must be empty.
3. Run `git fetch origin && git rev-list HEAD..origin/production --count` → must be 0.
4. Confirm with the user in plain English: "I'm about to deploy commit `<short-sha>` (`<commit-message>`) to production via `npm run deploy:pages:production`. Proceed?"
5. Only after explicit user "yes" — run `npm run deploy:pages:production`.
6. After success, tag the deploy as above.

If any of steps 1-3 fail, stop and tell the user. Do not attempt to fix the state automatically.

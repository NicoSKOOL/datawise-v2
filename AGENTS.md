# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Deployment Safety

- Read `DEPLOY.md` before any deploy, release, staging, preview, or Cloudflare task.
- `production` is the live source branch. `main` is stale legacy and must not be used for app source work.
- App changes go staging or preview first, production last. Never use `https://datawiseseo.com` as the first test target.
- `https://datawiseseo.com` is the app. `https://www.datawiseseo.com` is the marketing site.
- Production app deploys must use `npm run deploy:pages:production` from a clean `production` checkout. Never deploy production with raw `wrangler pages deploy`.
- Before frontend edits, verify the current app surface includes Content Writer:
  `rg -n "ContentWriter|/content-writer" datawise-seo-insight-main/src/App.tsx datawise-seo-insight-main/src/pages/ContentWriter.tsx`
- Stage specific files only. Do not use `git add .` or `git add -A`.
- Never commit secret values, staging login URLs, Cloudflare tokens, Google secrets, or API keys. Mention secret names only.

## Project Overview

DataWise V2 is an SEO analytics platform. The codebase lives in `datawise-seo-insight-main/` and consists of two independent apps: a React frontend and a Cloudflare Workers API backend.

The project is being modernized from Supabase to Cloudflare (D1 + KV + Workers). Legacy Supabase edge functions still exist in `supabase/functions/` but the new backend is in `workers/`. See `tasks/todo.md` for migration progress.

## Architecture

### Frontend (`datawise-seo-insight-main/`)
- React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui (Radix primitives)
- Path alias: `@` maps to `./src/`
- Dev server runs on port 8080
- Auth via Google OAuth through the Workers API
- State management: React Query (`@tanstack/react-query`) for server state, React Context for auth
- Routing: `react-router-dom` v6 with `ProtectedRoute` wrapper
- Key contexts: `AuthContext` (handles Google OAuth flow)
- Frontend calls `VITE_API_URL` (set in `.env`) for all API requests

### Backend (`datawise-seo-insight-main/workers/`)
- Cloudflare Worker with D1 (SQLite) database and KV storage
- Single entry point: `src/index.ts` with manual route matching (no framework router)
- Route modules in `src/routes/`: `keywords.ts`, `competitors.ts`, `ai.ts`, `rank-tracking.ts`
- Auth: `src/auth/google.ts` (Google OAuth), `src/middleware/auth.ts` (session validation)
- GSC integration: `src/gsc/` (Google Search Console OAuth + data sync)
- Chat/LLM: `src/chat/` with multi-provider LLM abstraction in `src/llm/`
- DataForSEO API calls: `src/dataforseo/`
- DB schema: `src/db/schema.sql`
- Secrets managed via `wrangler secret put` (see `wrangler.toml` comments)

### Legacy Backend (`datawise-seo-insight-main/supabase/`)
- Edge functions in `supabase/functions/` (being migrated to Workers)
- Migrations in `supabase/migrations/`
- Frontend still has `src/integrations/supabase/` (client + types) from the old setup

## Commands

### Frontend (run from `datawise-seo-insight-main/`)
```sh
npm ci --legacy-peer-deps     # Clean install for this dependency graph
npm run dev                   # Start dev server (port 8080)
npm run build                 # Plain Vite build
npm run deploy:pages:check    # Guarded build/check, no upload
npm run deploy:pages:production # Guarded production Pages deploy from clean production only
npm run lint                  # ESLint
```

### Workers API (run from `datawise-seo-insight-main/workers/`)
```sh
npm install          # Install dependencies
npm run dev          # Start local worker (wrangler dev)
npm run deploy       # Deploy production Worker as datawise-api
npm run deploy:staging # Deploy staging Worker only when staging env exists on branch
npm run db:migrate   # Run D1 schema migration (dev)
npm run db:migrate:staging
```

Do not use Worker `npm run deploy:production` unless `wrangler.toml` explicitly defines a production env. The production Worker currently deploys with `npm run deploy`.

### Environment
- Frontend: copy `.env.example` to `.env`, set `VITE_API_URL`
- Workers: secrets set via `wrangler secret put` (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ENCRYPTION_KEY, DATAFORSEO_EMAIL, DATAFORSEO_PASSWORD, LLM keys)

## Key API Route Groups

| Prefix | Module | Purpose |
|--------|--------|---------|
| `/api/keywords/*` | `routes/keywords.ts` | Keyword research (related, suggestions, ideas, difficulty, overview) |
| `/api/competitors/*` | `routes/competitors.ts` | Domain analysis, ranked keywords, gap analysis, traffic estimation |
| `/api/ai/*` | `routes/ai.ts` | AI visibility checks (Google AI Mode, ChatGPT, Perplexity, PAA, Lighthouse, Geo) |
| `/api/rank-tracking/*` | `routes/rank-tracking.ts` | Projects + keyword rank tracking CRUD |
| `/gsc/*` | `gsc/` | Google Search Console OAuth + data sync |
| `/chat` | `chat/handler.ts` | SEO Assistant chat with LLM |
| `/auth/*` | `auth/google.ts` | Google OAuth login/logout/session |

## Task Tracking

- `tasks/todo.md`: Current migration progress and phase checklist
- `tasks/lessons.md`: Accumulated patterns and corrections

## Orchestration Rules

### Delegation
- Default to spawning subagents for research, file reads, exploration, analysis, and parallel tasks
- Keep main context clean: pass file paths and summaries, not full contents
- One task per subagent, scoped and focused

### Planning
- Enter plan mode for any non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, stop and re-plan immediately

### Context Management
- At 50% context used: stop, summarize, compact, and continue
- After compacting, re-read `tasks/todo.md` and `tasks/lessons.md`

### Session Startup
1. Read `DEPLOY.md`, `tasks/todo.md`, and `tasks/lessons.md`
2. Before frontend work or `npm run dev`, verify the active app is the latest Writer-enabled surface:
   - `datawise-seo-insight-main/src/App.tsx` must import `ContentWriter`
   - `datawise-seo-insight-main/src/App.tsx` must route `/content-writer`
   - `datawise-seo-insight-main/src/pages/ContentWriter.tsx` must exist
   - If any check fails, stop immediately and locate/consolidate the correct worktree/branch before editing or running the app
3. Confirm the current task before writing code
4. If context is already high from startup reads, compact before starting

### Self-Improvement
- After any user correction: update `tasks/lessons.md`
- Never retry the same fix more than twice: re-plan instead

### Verification
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness

### Output
- Report: what changed, why, what's next
- No trailing summaries or restating what you're about to do

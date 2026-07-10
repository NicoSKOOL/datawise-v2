# Blueprint V1 Integration Design (DataWise, staging-first)

Date: 2026-07-10
Status: approved direction, pending implementation plan
Source spec: `blueprint-v1-developer-handoff/` (README, DEVELOPER_MANUAL, DATAFORSEO_CALL_CATALOG, API_AND_DATA_CONTRACTS, FUNCTION_CATALOG, OPENROUTER_CONTRACTS, IMPLEMENTATION_AND_ACCEPTANCE)

## Decision summary

| Decision | Choice |
|---|---|
| Architecture | Feature inside DataWise (overrides the handoff's standalone-repo rule) |
| Scope | Full spec, phased (the handoff's 9 phases, adapted) |
| Gating | Admin-only allowlist + per-run USD budget cap, staging-first |
| Database | New separate D1 `blueprint-db` bound to the existing `datawise-api` worker |

## What Blueprint is

One business brief in; one editable, cited website blueprint out. Intake wizard (business, up to 10 services, up to 5 service areas, one country/language, optional existing site and competitors) feeds a durable 19-stage research pipeline (DataForSEO evidence: keywords, competitors, SERP, PAA, conditional fan-out; OpenRouter: embeddings, cluster adjudication, page-brief synthesis). Output: a page hierarchy where every page carries keywords, metrics, evidence refs, an outline, internal links, a Create/Update/Keep/Consolidate recommendation, and a rationale. Views: interactive map canvas + equivalent table + evidence inspector. Exports: CSV, XLSX, Markdown, JSON, proposed sitemap.

## Codebase placement

- Worker module: `datawise-seo-insight-main/workers/src/blueprint/` with `contracts/`, `domain/`, `stages/`, `routes/`, `providers/`, `exports/`.
- Routes mounted under `/api/blueprint/v1/*` in the worker's manual router.
- Frontend: `src/pages/blueprint/` + `src/components/blueprint/`, sidebar group rendered only for admin.

## Boundary rule (replaces the handoff's Phase 0 "no DataWise imports" ADR)

- Blueprint MAY import shared infrastructure: auth middleware, DataForSEO client (`workers/src/dataforseo/`), LLM layer (`workers/src/llm/`), D1/KV helpers.
- No existing DataWise feature may import from `blueprint/`.
- Blueprint touches no existing D1 tables except `users` (auth/admin flag). All Blueprint state lives in `blueprint-db`.
- Enforced by a lint/grep check in CI or pre-merge.

## Infrastructure (one-time setup, production worker)

- New D1 database `blueprint-db`, binding `BLUEPRINT_DB`. Separate because `datawise-db` hit its 10GB cap 2026-06-25 and Blueprint adds ~40 evidence-heavy tables; isolation makes purging trivial.
- New KV namespace binding `BLUEPRINT_KV` (provider caches with catalog TTLs: locations 7d, keyword Labs 14d, competitor Labs 7d, SERP 24h, content 7d, fan-out 24h; negative TTLs; single-flight locks).
- New R2 bucket `blueprint-artifacts` (raw provider envelopes, export files).
- Cloudflare Queue `blueprint-research`, consumer on the same worker, one stage per invocation.
- Credentials: existing platform DataForSEO account and platform OpenRouter key (same pattern as Content Writer). Model roles (`semantic_embedding`, `semantic_fast`, `brief_quality`, `narrative_quality`) are configuration, not hardcoded slugs.

## Orchestration (spec-faithful)

19-stage state machine (`validate_intake` → `publish_blueprint`), `research_stage_runs` keyed `UNIQUE(run_id, stage_name, stage_input_hash)`, lease owner + fencing epoch + compare-and-swap completion, idempotency records, per-run budget reservations reconciled against actual provider-reported cost. Critical stages fail the run; noncritical stages degrade to a partial blueprint. Immutable `blueprint_versions` + append-only `blueprint_revisions`.

## Gating and cost control

- Every `/api/blueprint/*` route requires a valid session plus an allowlist check (user id in config, not hardcoded email). Non-allowlisted users get 404-equivalent behavior.
- No run without a persisted estimate; each run has a hard USD ceiling; a global monthly Blueprint cap sits on top.
- First paid end-to-end run: after Phase 3, minimal brief (1 service, 1 area), ~$2 ceiling.

## Staging model

There is no staging worker; staging.datawise-118.pages.dev talks to the production `datawise-api` worker. Therefore:

- Backend ships to the production worker but is inert for everyone except the allowlist.
- Frontend ships to the `staging` branch (auto-deploys the staging Pages site) for testing; merges to `production` only when a phase is accepted, and stays flag-hidden even then.
- Per phase: feature branch off `production` → build → PR → worker deploy → push branch to `staging` → admin test on staging URL → merge → tag (the existing 7-step workflow).

## Build phases (adapted from IMPLEMENTATION_AND_ACCEPTANCE.md)

0. Scaffolding: bindings, wrangler.toml, admin gate, boundary check, module skeleton.
1. Contracts + deterministic domain engine (fixtures only, no paid calls, unit tests).
2. Persistence + durable orchestration (leases, fencing, idempotency, budget reservations, immutable publish).
3. DataForSEO adapters (catalog's 9-step build order). First staging end-to-end smoke run.
4. Clustering + page-planning engine (guardrails: no auto service-x-location pages, unique slugs and primary keywords, doorway/cannibalization checks).
5. OpenRouter structured AI (strict json_schema, evidence-ID allowlist validation, one repair + one fallback max, never publish invalid output).
6. Intake wizard + estimate + progress UX.
7. Blueprint Canvas map + table + inspector (URL-synced selection, virtualized table, WCAG-AA keyboard spec).
8. Exports (5 formats, formula-injection neutralized) + operational readiness.

## Acceptance highlights (from the handoff, unchanged)

Missing metrics render as null/`—` never 0; same idempotency key returns one run; stale workers cannot persist; concurrent reservations cannot cross the ceiling; no two active pages share a slug or primary keyword; invalid AI output cannot publish; a previous complete blueprint stays readable during a new run; CSV/XLSX formula injection neutralized; cross-tenant and SSRF tests pass.

## Open items (from the handoff's open questions, resolved for this integration)

- BYOK vs platform-paid: platform-paid (both providers), admin-only while gated.
- Auth provider: existing DataWise session auth.
- Spend caps: per-run ceiling + global monthly cap.
- Retention: revisit before opening beyond admin; separate DB makes purge easy.
- Markets: whatever DataForSEO supports; UI defaults to your primary markets.
- Site-ownership confirmation, editable-field list, export sharing: defer to later phases.

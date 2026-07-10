# Blueprint module

Turns a business brief into an evidence-backed website architecture plan.
Spec: docs/superpowers/specs/2026-07-10-blueprint-v1-integration-design.md
Handoff: blueprint-v1-developer-handoff/ (repo root of the main checkout)

Boundary rules:
- This module MAY import shared infra: middleware/auth, auth/google (AuthUser), routes/admin (isAdmin),
  dataforseo/, llm/, and the Env type from ../index.
- Nothing outside this folder may import from it, except the single route mount
  in workers/src/index.ts. Enforced by scripts/check-blueprint-boundary.mjs.
- All state lives in BLUEPRINT_DB (blueprint-db), never in the main DB.

Layout: contracts/ (DTOs, enums, zod), domain/ (pure engine), routes/ (handlers),
stages/ (pipeline, Phase 2+), providers/ (adapters, Phase 3+), exports/ (Phase 8).

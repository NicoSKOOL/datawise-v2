# DataWise Staging-To-Production Runbook

Read this before changing or deploying DataWise. This is the canonical deployment guide for Codex, Claude, and any other agent working in this folder.

## Source Of Truth

- Live source branch: `production`
- Stale legacy branch: `main`
- Production app: `https://datawiseseo.com`
- Marketing site: `https://www.datawiseseo.com`
- Staging preview app: `https://preview-1.datawise-118.pages.dev`
- Production API: `https://datawise-api.nico-510.workers.dev`
- Staging API: `https://datawise-api-staging.nico-510.workers.dev`
- Cloudflare account ID: `510d0ac03a3a8f5ebeac39be4926ed77`
- Current verified production deployment: `https://a16b4d3b.datawise-118.pages.dev`
- Current verified production source commit: `813b492`

The Cloudflare Pages project may record production deployments under branch `main`. Treat that only as the Pages production-branch setting. Git source work must still start from and land on `production`.

## Mandatory Flow

Production is always last:

1. Start from the latest `production`.
2. Create a feature or hotfix branch.
3. Make the smallest scoped change.
4. Run local checks.
5. Verify the change on staging or a Cloudflare Pages preview URL.
6. Merge the verified change to `production` through PR, or push a production hotfix only with explicit approval.
7. Deploy production only after preview verification.

Never use `https://datawiseseo.com` as the first test target.

## Standard App Change

```sh
cd "/Users/nicolasgorrono/Desktop/DataWise V2"
git fetch origin
git switch production
git pull origin production
git switch -c codex/<short-change-name>
```

Before frontend work, confirm this is the current app surface:

```sh
rg -n "ContentWriter|/content-writer" datawise-seo-insight-main/src/App.tsx datawise-seo-insight-main/src/pages/ContentWriter.tsx
```

If Content Writer is missing, stop. You are on an old app surface.

Use specific staging commands only:

```sh
git add <specific-files>
git commit -m "<clear message>"
git push -u origin codex/<short-change-name>
```

Do not use `git add .` or `git add -A`.

Open a PR with base `production`, review the diff, and verify staging or preview before merging. If the diff contains unrelated deletes or rewrites, stop.

## Local Checks

Run from `datawise-seo-insight-main/`.

```sh
npm ci --legacy-peer-deps
npm run deploy:pages:check
```

Use `npm install --legacy-peer-deps` instead when working in an existing local checkout. The project can hit a React/Lobehub peer dependency conflict without the legacy peer resolver.

The deploy guard checks the branch, source markers, bundle markers, API URL, and known stale patterns. It also archives the exact deployable build under `deploy-archives/pages/`.

## Staging And Preview

Use staging or preview before production for every app change.

- Staging preview app: `https://preview-1.datawise-118.pages.dev`
- Staging API: `https://datawise-api-staging.nico-510.workers.dev`
- Preview builds must use `VITE_API_URL=https://datawise-api-staging.nico-510.workers.dev`.
- Production builds must use `VITE_API_URL=https://datawise-api.nico-510.workers.dev`.

Staging-only protected test login is useful when Google OAuth is not configured for a preview origin. It must stay staging-only:

- Worker var: `ENVIRONMENT=staging`
- Worker secret: `STAGING_LOGIN_SECRET`
- Optional Worker var: `STAGING_LOGIN_EMAIL`
- Test URL shape: `/auth/test-login#token=<secret>`

Do not write the real staging login URL or token into Git. The hash keeps the token out of the Pages HTTP request, but it is still a secret.

Google login on staging/preview requires adding the preview origin in Google Cloud OAuth settings. If that is not done, use the protected staging test login instead.

Some staging automation and preview workflow work is available in the setup branch or PR until merged into `production`. If the workflow file is not present on the branch you are using, document that and use the manual staging URL verification path.

## Production Deploy

Production deploys use only this guarded command from a clean `production` checkout:

```sh
cd "/Users/nicolasgorrono/Desktop/DataWise V2/datawise-seo-insight-main"
git switch production
git pull origin production
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 npm run deploy:pages:production
```

Never run raw `wrangler pages deploy dist --project-name=datawise` for production. Raw Wrangler bypasses the app guard and can ship an old or incomplete bundle.

Before production deploy, verify:

```sh
git rev-parse --abbrev-ref HEAD
git status --porcelain
git rev-list HEAD..origin/production --count
```

Expected results:

- Branch is `production`.
- Status is empty.
- Behind count is `0`.

If Wrangler reports multiple Cloudflare accounts, use:

```sh
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77
```

After deploy, verify `https://datawiseseo.com/` serves the new hashed JS asset and that the bundle uses the production API, not staging.

## Worker API

The Worker API lives in `datawise-seo-insight-main/workers/`.

Production API deploy:

```sh
cd datawise-seo-insight-main/workers
npm run deploy
```

Staging API deploy, when the staging env exists on the current branch:

```sh
cd datawise-seo-insight-main/workers
npm run deploy:staging
```

Do not run Worker deploys as part of a docs-only change.

## Rollback

Primary rollback path is Cloudflare Pages deployment history. List recent deployments:

```sh
cd datawise-seo-insight-main
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
  npx wrangler pages deployment list --project-name=datawise
```

Known recovery references:

- Current verified deployment after the keyword tab-state fix: `https://a16b4d3b.datawise-118.pages.dev`, commit `813b492`
- Earlier known-good deployment: `https://079cdbe3.datawise-118.pages.dev`
- Earlier known-good tag: `prod-2026-05-13-2327-live`

After rollback or deploy, verify:

```sh
curl -sL https://datawiseseo.com/ | rg "assets/index-"
curl -sL https://datawiseseo.com/assets/<asset-file>.js | rg "datawise-api.nico-510|datawise-api-staging|http://localhost:8787"
```

The production bundle must contain `datawise-api.nico-510`, must not contain `datawise-api-staging`, and must not contain `http://localhost:8787`.

Open SPA tabs can keep running an old hashed JS bundle. If a user reports that production still looks old right after deploy, ask them to hard refresh or open a fresh tab, then verify the live HTML asset hash.

## Never Do This

- Do not deploy production before staging or preview verification.
- Do not deploy production from `main`.
- Do not deploy production from a dirty workspace.
- Do not deploy production with raw `wrangler pages deploy`.
- Do not use the live app as the first test target.
- Do not commit Cloudflare tokens, staging login URLs, Google secrets, or API keys.
- Do not stage broad unrelated changes.

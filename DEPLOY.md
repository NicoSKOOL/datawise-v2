# DataWise Deploy Rules

Read this before changing or deploying the app.

## Source of Truth

- Git source branch for the live app: `production`
- Live app domain: `https://datawiseseo.com`
- Marketing site domain: `https://www.datawiseseo.com`
- Production API: `https://datawise-api.nico-510.workers.dev`

Do not deploy from `main`, a dirty local workspace, a temp reconstruction, or a raw `dist` folder. The `main` branch is stale for app source. Cloudflare Pages currently records production deployments under branch `main`, but that is only the Pages project production-branch setting; the Git source must still be `production`.

## Mandatory Promotion Order

1. Build and test locally.
2. Deploy and verify a Cloudflare Pages preview/staging URL.
3. Deploy production last.

Never use `datawiseseo.com` as the first test target. If no preview/staging URL exists for the change, stop and create one before production.

## Standard Change Flow

```sh
cd "/Users/nicolasgorrono/Desktop/DataWise V2/datawise-seo-insight-main"
git fetch origin
git switch production
git pull origin production
git switch -c fix/short-description
```

Make the change, then verify locally:

```sh
cd datawise-seo-insight-main
npm run lint
npm run deploy:pages:check
```

Push the branch, open a PR with base `production`, and review the diff. If the PR includes unrelated deletes or rewrites, stop.

The GitHub preview and production workflows require the repo secret `CLOUDFLARE_API_TOKEN`. It must be a Cloudflare API token that can deploy the `datawise` Pages project. If that secret is missing, the workflows stop before trying to deploy.

The Worker CORS allowlist must include the Cloudflare Pages preview domain pattern `https://*.datawise-118.pages.dev`; otherwise preview builds load but browser API calls fail before they can be tested.

For daily preview testing, staging can use a protected test-login shortcut instead of Google OAuth. This must only be enabled on a staging Worker:

- `ENVIRONMENT=staging`
- `STAGING_LOGIN_SECRET=<long random secret>`
- optional `STAGING_LOGIN_EMAIL=staging-admin@datawiseseo.test`

Use the preview link format `/auth/test-login#token=<secret>`. The hash keeps the secret out of the HTTP request to the Pages site; the frontend sends it directly to the staging API.

Preview Pages builds must use `VITE_API_URL=https://datawise-api-staging.nico-510.workers.dev`. Production Pages builds must use `VITE_API_URL=https://datawise-api.nico-510.workers.dev`.

Before merging or deploying production, verify the preview/staging URL for the flows touched by the change. For auth changes, verify at least:

- `/auth`
- `/forgot-password`
- email signup/login/reset behavior
- Google auth initiation

## Production Deploy

Production deploys must use the guarded command or the guarded GitHub workflow only:

```sh
cd "/Users/nicolasgorrono/Desktop/DataWise V2/datawise-seo-insight-main"
git switch production
git pull origin production
npm run deploy:pages:production
```

The guard must pass before upload. It checks branch cleanliness, required source markers, required bundle markers, production API URL, and known stale/broken patterns.

## Rollback

Primary rollback path is Cloudflare Pages deployment history.

```sh
cd "/Users/nicolasgorrono/Desktop/DataWise V2/datawise-seo-insight-main"
CLOUDFLARE_ACCOUNT_ID=510d0ac03a3a8f5ebeac39be4926ed77 \
  npx wrangler pages deployment list --project-name=datawise
```

Pick the last known-good deployment ID and roll back via Cloudflare API or dashboard.

Keep Git deploy tags for source recovery:

```sh
TS=$(date -u +%Y-%m-%d-%H%M)
git tag -a "prod-$TS" -m "deploy"
git push origin --tags
```

Known recovery tag:

- `prod-2026-05-13-2327-live`

## Never Do This

- Do not deploy production before preview/staging verification.
- Do not deploy from `main`.
- Do not deploy from a dirty workspace.
- Do not run raw `wrangler pages deploy dist --project-name=datawise` for production.
- Do not use `git add .` or `git add -A` for app changes.
- Do not merge a PR if it deletes unrelated app surfaces.

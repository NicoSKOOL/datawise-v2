# DataWise App Deployment Notes

The canonical deployment runbook is the root `DEPLOY.md`. Read that file first.

## App URLs

- Production app: `https://datawiseseo.com`
- Marketing site: `https://www.datawiseseo.com`
- Staging preview app: `https://preview-1.datawise-118.pages.dev`
- Production API: `https://datawise-api.nico-510.workers.dev`
- Staging API: `https://datawise-api-staging.nico-510.workers.dev`

## Frontend Commands

Run from `datawise-seo-insight-main/`.

```sh
npm ci --legacy-peer-deps
npm run dev
npm run build
npm run deploy:pages:check
npm run deploy:pages:production
```

Use `npm run deploy:pages:production` only from a clean `production` checkout after staging or preview verification. Do not deploy production with raw `wrangler pages deploy`.

## Worker Commands

Run from `datawise-seo-insight-main/workers/`.

```sh
npm install
npm run dev
npm run deploy
```

When a branch contains the staging Worker env, staging deploys use:

```sh
npm run deploy:staging
```

Do not run Worker deploys for frontend-only or docs-only changes.

## Staging Login

Staging can use protected test login when Google OAuth is not configured for the preview origin.

- Worker secret name: `STAGING_LOGIN_SECRET`
- Optional Worker var: `STAGING_LOGIN_EMAIL`
- URL shape: `/auth/test-login#token=<secret>`

Do not commit the real test-login URL or token.

## Production Verification

After deploy, verify the app domain serves the expected bundle:

```sh
curl -sL https://datawiseseo.com/ | rg "assets/index-"
```

Then inspect the asset to confirm it references the production API, not staging or localhost.

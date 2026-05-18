#!/usr/bin/env node
//
// Staging deploy for the DataWise SPA.
//
// Staging is a *dress rehearsal* of the production deploy. It reuses the EXACT
// production guard (deploy-pages-production.mjs in check-only mode) so a build
// can never reach staging more leniently than it would reach production. If a
// feature is missing or a forbidden stale marker is present, staging refuses,
// and you find out BEFORE the live site is ever touched.
//
// The validated build is then published to the Cloudflare Pages "staging"
// branch alias, which gives a single, permanent URL:
//
//     https://staging.datawise-118.pages.dev
//
// That URL always points at the most recent staging deploy. It talks to the
// live Worker API (the same VITE_API_URL as production), so it is safe for
// testing screens and bug fixes against real data. It is NOT an isolated
// data sandbox.
//
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: appRoot,
    stdio: 'inherit',
    env: process.env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
  }
}

async function main() {
  // 1. Run the production guard in check-only mode (no --deploy flag).
  //    This builds dist/, validates every required/forbidden source and
  //    bundle marker, and archives the exact build. Identical guard,
  //    zero duplication, impossible to drift looser than production.
  run('node', ['scripts/deploy-pages-production.mjs']);

  // 2. Publish the validated build to the stable staging alias.
  //    --branch=staging is NOT the Cloudflare production branch, so this
  //    is a preview deployment and cannot affect datawiseseo.com.
  run('npx', [
    'wrangler',
    'pages',
    'deploy',
    'dist',
    '--project-name=datawise',
    '--branch=staging',
  ]);

  console.log('');
  console.log('Staging deploy complete.');
  console.log('Open: https://staging.datawise-118.pages.dev');
  console.log('(Same live API + data as production. Test, then promote via a PR into `production`.)');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

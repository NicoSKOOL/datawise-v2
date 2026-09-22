#!/usr/bin/env node
// Refuses a production Worker deploy unless the code being deployed is exactly
// origin/production. A worker deployed from a feature branch silently rolls
// back every fix that is live but not on that branch: PR #140's Local Pack fix
// was lost this way on 2026-09-08, and bug batch 7 nearly was on 2026-09-22.
//
// Passes automatically in the GitHub Actions production workflow (which checks
// out `production` itself). To test unmerged Worker code, use
// `npm run deploy:preview` instead: it uploads a version to the staging preview
// URL without sending it any live traffic.
//
// Emergency escape hatch: ALLOW_UNSAFE_DEPLOY=1 npm run deploy
import { execSync } from 'node:child_process';

const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function fail(reason, fix) {
  console.error(`\n  Worker deploy BLOCKED: ${reason}\n`);
  if (fix) console.error(`  ${fix}\n`);
  console.error('  To test unmerged code without touching live traffic: npm run deploy:preview');
  console.error('  Emergency override (you own the consequences): ALLOW_UNSAFE_DEPLOY=1 npm run deploy\n');
  process.exit(1);
}

if (process.env.ALLOW_UNSAFE_DEPLOY === '1') {
  console.warn('\n  WARNING: ALLOW_UNSAFE_DEPLOY=1, skipping the production deploy guard.\n');
  process.exit(0);
}

if (process.env.GITHUB_ACTIONS === 'true') {
  if (process.env.GITHUB_REF !== 'refs/heads/production') {
    fail(`CI run is for ${process.env.GITHUB_REF}, not refs/heads/production.`);
  }
  console.log('Worker deploy guard passed (GitHub Actions, production branch).');
  process.exit(0);
}

const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'production') {
  fail(`current branch is "${branch}", not "production".`, 'Merge your PR, then deploy from an up-to-date production checkout.');
}

const dirty = sh('git status --porcelain --untracked-files=no');
if (dirty) {
  fail('there are uncommitted changes to tracked files.', dirty.split('\n').slice(0, 10).join('\n  '));
}

sh('git fetch origin production --quiet');
const head = sh('git rev-parse HEAD');
const remote = sh('git rev-parse origin/production');
if (head !== remote) {
  fail(`HEAD ${head.slice(0, 7)} is not origin/production ${remote.slice(0, 7)}.`, 'Run: git pull --ff-only origin production');
}

console.log(`Worker deploy guard passed: deploying origin/production ${head.slice(0, 7)}.`);

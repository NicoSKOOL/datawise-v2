#!/usr/bin/env node
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');
const workspaceRoot = path.resolve(appRoot, '..');
const args = new Set(process.argv.slice(2));

const deploy = args.has('--deploy');
const confirmProduction = args.has('--confirm-production');
const skipBuild = args.has('--skip-build');

const EXPECTED_BRANCH = 'production';
const EXPECTED_API_URL = 'https://datawise-api.nico-510.workers.dev';
const FORBIDDEN_BUNDLE_MARKERS = [
  ['Local development API URL', 'http://localhost:8787'],
];
const REQUIRED_BUNDLE_MARKERS = [
  ['Content Writer route', '/content-writer'],
  ['Content Writer entry point', 'Content Writer'],
  ['People Also Ask surface', 'People Also Ask'],
  ['Fan-out Queries surface', 'Fan-out Queries'],
  ['Content Planner surface', 'Content Planner'],
  ['Content Tools surface', 'Content Tools'],
  ['Production Worker API URL', EXPECTED_API_URL],
  ['Keyword CPC tooltip text', 'Green means higher CPC and stronger commercial value.'],
  ['Keyword metric green state', 'bg-emerald-50'],
  ['Keyword metric amber state', 'bg-amber-50'],
  ['Keyword metric red state', 'bg-red-50'],
];

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? appRoot,
    stdio: options.stdio ?? 'inherit',
    env: process.env,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
  }

  return result.stdout ?? '';
}

function git(commandArgs, options = {}) {
  return execFileSync('git', commandArgs, {
    cwd: options.cwd ?? workspaceRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function currentBranch() {
  return git(['branch', '--show-current']) || process.env.GITHUB_REF_NAME || 'detached-head';
}

function slug(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

async function collectTextFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectTextFiles(fullPath));
      continue;
    }

    if (/\.(html|js|css|json|txt|svg)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function readBundleText(distDir) {
  const files = await collectTextFiles(distDir);
  const parts = [];

  for (const file of files) {
    parts.push(await readFile(file, 'utf8'));
  }

  return parts.join('\n');
}

async function validateDist(distDir) {
  if (!existsSync(path.join(distDir, 'index.html'))) {
    throw new Error(`Missing ${path.join(distDir, 'index.html')}; build output is not deployable.`);
  }

  const bundleText = await readBundleText(distDir);
  const missing = REQUIRED_BUNDLE_MARKERS
    .filter(([, marker]) => !bundleText.includes(marker))
    .map(([name, marker]) => `${name}: ${marker}`);
  const forbidden = FORBIDDEN_BUNDLE_MARKERS
    .filter(([, marker]) => bundleText.includes(marker))
    .map(([name, marker]) => `${name}: ${marker}`);

  if (missing.length > 0 || forbidden.length > 0) {
    throw new Error(
      [
        'Production deploy guard failed.',
        missing.length ? 'Missing required active app markers:' : '',
        ...missing.map((item) => `- ${item}`),
        forbidden.length ? 'Forbidden stale markers found:' : '',
        ...forbidden.map((item) => `- ${item}`),
      ].filter(Boolean).join('\n'),
    );
  }
}

async function directorySize(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  let total = 0;

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    total += entry.isDirectory() ? await directorySize(fullPath) : (await stat(fullPath)).size;
  }

  return total;
}

async function archiveDist({ distDir, branch, commit, appStatus }) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archiveName = `${timestamp}--${slug(branch)}--${commit}${appStatus ? '--dirty' : ''}`;
  const archiveRoot = path.join(workspaceRoot, 'deploy-archives', 'pages', archiveName);
  const archiveDistDir = path.join(archiveRoot, 'dist');
  const manifest = {
    app: 'datawise',
    target: 'cloudflare-pages-production',
    createdAt: new Date().toISOString(),
    branch,
    commit,
    appStatus: appStatus || 'clean',
    rollbackTarget: {
      deploymentId: '079cdbe3-cef8-4df0-b7ed-c429f4f27c55',
      deploymentUrl: 'https://079cdbe3.datawise-118.pages.dev',
    },
    requiredBundleMarkers: REQUIRED_BUNDLE_MARKERS.map(([name, marker]) => ({ name, marker })),
    forbiddenBundleMarkers: FORBIDDEN_BUNDLE_MARKERS.map(([name, marker]) => ({ name, marker })),
    archiveDistDir,
    restoreCommand: `npx wrangler pages deploy "${archiveDistDir}" --project-name=datawise --branch=main --commit-dirty=true`,
  };

  await rm(archiveRoot, { recursive: true, force: true });
  await mkdir(archiveRoot, { recursive: true });
  await writeFile(path.join(distDir, 'deploy-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await cp(distDir, archiveDistDir, { recursive: true });
  await writeFile(path.join(archiveRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(archiveRoot, 'source-status.txt'), `${appStatus || 'clean'}\n`);

  return { archiveDistDir };
}

async function main() {
  const branch = currentBranch();
  const commit = git(['rev-parse', '--short', 'HEAD']);
  const appRelative = path.relative(workspaceRoot, appRoot);
  const appStatus = git(['status', '--short', '--', appRelative, '.github/workflows/deploy-pages-production.yml'], { cwd: workspaceRoot });
  const distDir = path.join(appRoot, 'dist');

  console.log('DataWise Pages production guard');
  console.log(`App: ${appRoot}`);
  console.log(`Branch: ${branch}`);
  console.log(`Commit: ${commit}`);
  console.log(`App status: ${appStatus ? 'dirty' : 'clean'}`);

  if (process.env.VITE_API_URL !== EXPECTED_API_URL) {
    throw new Error(`VITE_API_URL must be ${EXPECTED_API_URL}; received ${process.env.VITE_API_URL || 'unset'}.`);
  }

  if (deploy) {
    if (!confirmProduction) {
      throw new Error('Refusing production deploy without --confirm-production.');
    }
    if (branch !== EXPECTED_BRANCH) {
      throw new Error(`Refusing production deploy from branch "${branch}". Deploy from "${EXPECTED_BRANCH}" only.`);
    }
    if (appStatus) {
      throw new Error('Refusing production deploy with uncommitted app changes.');
    }
  }

  if (!skipBuild) {
    run('npm', ['run', 'build']);
  }

  await validateDist(distDir);
  const size = await directorySize(distDir);
  const archive = await archiveDist({ distDir, branch, commit, appStatus });

  console.log(`Bundle guard passed (${Math.round(size / 1024)} KiB).`);
  console.log(`Archived exact deployable build at: ${archive.archiveDistDir}`);

  if (!deploy) {
    console.log('Check-only mode complete. No production deploy was started.');
    return;
  }

  run('npx', [
    'wrangler',
    'pages',
    'deploy',
    'dist',
    '--project-name=datawise',
    '--branch=main',
  ]);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

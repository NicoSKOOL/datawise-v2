#!/usr/bin/env node
// Enforces: no file outside workers/src/blueprint imports from it,
// except the route mount in workers/src/index.ts.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCAN_ROOT = join(ROOT, 'workers', 'src');
const ALLOWED = new Set(['workers/src/index.ts']);
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"][^'"]*\bblueprint(?:\/[^'"]*)?['"]/;
const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = relative(ROOT, full).split('\\').join('/');
    if (statSync(full).isDirectory()) {
      if (rel === 'workers/src/blueprint' || entry === 'node_modules') continue;
      walk(full);
    } else if (/\.(?:m|c)?[tj]sx?$/.test(entry) && !ALLOWED.has(rel)) {
      if (IMPORT_RE.test(readFileSync(full, 'utf8'))) violations.push(rel);
    }
  }
}
walk(SCAN_ROOT);
if (violations.length) {
  console.error('Blueprint boundary violations (files importing workers/src/blueprint):');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('Blueprint boundary check passed.');

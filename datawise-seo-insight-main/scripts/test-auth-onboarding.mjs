#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const authPage = readFileSync(path.join(appRoot, 'src/pages/Auth.tsx'), 'utf8');

const checks = [
  [
    'Auth page reads the mode query parameter',
    /useSearchParams/.test(authPage) && /modeParam/.test(authPage),
  ],
  [
    'Signup query mode initializes create-account state',
    /modeParam\s*===\s*['"]signup['"]\s*\?\s*['"]signup['"]\s*:\s*['"]login['"]/.test(authPage),
  ],
  [
    'Google create-account button is explicit',
    /Create account with Google/.test(authPage),
  ],
  [
    'Google login button is explicit',
    /Log in with Google/.test(authPage),
  ],
  [
    'Both Google buttons use the same forgiving OAuth handler',
    (authPage.match(/signInWithGoogle/g) || []).length >= 3,
  ],
  [
    'Premium community path is explained in plain language',
    /Premium community members/.test(authPage) && /same email you used to join/.test(authPage),
  ],
];

let failed = 0;
for (const [name, passed] of checks) {
  if (passed) {
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} auth onboarding check${failed === 1 ? '' : 's'} failed.`);
  process.exit(1);
}

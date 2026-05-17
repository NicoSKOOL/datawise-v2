#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, '..');
const authPage = readFileSync(path.join(appRoot, 'src/pages/Auth.tsx'), 'utf8');
const loginChoiceIndex = authPage.indexOf('For returning members with an existing account.');
const signupChoiceIndex = authPage.indexOf('New to DataWise or joining from AI Ranking Skool.');

const checks = [
  [
    'Auth page reads the mode query parameter',
    /useSearchParams/.test(authPage) && /modeParam/.test(authPage),
  ],
  [
    'No mode query starts on the choice screen',
    /modeParam\s*===\s*['"]signup['"]\s*\?\s*['"]signup['"]\s*:\s*modeParam\s*===\s*['"]login['"]\s*\?\s*['"]login['"]\s*:\s*null/.test(authPage),
  ],
  [
    'Choice screen has the two high-level paths',
    /Create an account/.test(authPage) && loginChoiceIndex > -1 && signupChoiceIndex > -1,
  ],
  [
    'Choice screen puts login above create account',
    loginChoiceIndex > -1 && signupChoiceIndex > -1 && loginChoiceIndex < signupChoiceIndex,
  ],
  [
    'Choice rows have wrapping-safe content containers',
    /min-w-0 flex-1/.test(authPage) && /leading-5/.test(authPage),
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
    'Selected flows can return to the choice screen',
    /Back to choices/.test(authPage) && /next\.delete\(['"]mode['"]\)/.test(authPage),
  ],
  [
    'Google buttons use the same forgiving OAuth handler',
    /onClick=\{signInWithGoogle\}/.test(authPage),
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

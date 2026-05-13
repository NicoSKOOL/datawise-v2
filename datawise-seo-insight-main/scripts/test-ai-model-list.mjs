import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const outDir = mkdtempSync(path.join(tmpdir(), 'dw-ai-model-list-'));

execFileSync(
  path.join(rootDir, 'node_modules/.bin/tsc'),
  [
    'src/lib/ai-models.ts',
    '--target', 'ES2022',
    '--module', 'CommonJS',
    '--moduleResolution', 'node',
    '--rootDir', 'src',
    '--outDir', outDir,
    '--skipLibCheck',
  ],
  { cwd: rootDir, stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const models = require(path.join(outDir, 'lib/ai-models.js'));

const expectedIds = [
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash',
  'moonshotai/kimi-k2.6',
  'moonshotai/kimi-k2.5',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-sonnet-4.6',
  'openai/gpt-5.5-pro',
  'openai/gpt-5.5',
  'openai/gpt-5.4-mini',
];

assert.deepEqual(models.OPENROUTER_MODEL_IDS, expectedIds);
assert.equal(models.DEFAULT_OPENROUTER_MODEL, 'deepseek/deepseek-v4-pro');

const providers = models.OPENROUTER_PROVIDER_GROUPS.map((provider) => provider.id);
assert.deepEqual(providers, ['deepseek', 'moonshotai', 'anthropic', 'openai']);

for (const model of models.OPENROUTER_MODELS) {
  assert.ok(model.provider, `missing provider for ${model.id}`);
  assert.ok(models.isApprovedOpenRouterModel(model.id), `${model.id} must be approved`);
}

console.log('ai model list tests passed');

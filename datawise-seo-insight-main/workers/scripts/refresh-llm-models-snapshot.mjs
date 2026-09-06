#!/usr/bin/env node
// Refreshes src/dataforseo/llm-models.snapshot.json from the live DataForSEO
// models endpoints. The snapshot is what llm-models.test.ts checks PREFERRED_MODELS
// against, so a retired model fails CI instead of production.
//
//   DATAFORSEO_EMAIL=... DATAFORSEO_PASSWORD=... npm run llm-models:snapshot

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const email = process.env.DATAFORSEO_EMAIL;
const password = process.env.DATAFORSEO_PASSWORD;
if (!email || !password) {
  console.error('Set DATAFORSEO_EMAIL and DATAFORSEO_PASSWORD.');
  process.exit(1);
}

const providers = ['chat_gpt', 'claude', 'gemini', 'perplexity'];
const auth = Buffer.from(`${email}:${password}`).toString('base64');
const out = {
  _captured_at: new Date().toISOString().slice(0, 10),
  _source: 'GET https://api.dataforseo.com/v3/ai_optimization/{provider}/llm_responses/models',
};

for (const provider of providers) {
  const res = await fetch(`https://api.dataforseo.com/v3/ai_optimization/${provider}/llm_responses/models`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const data = await res.json();
  const task = data?.tasks?.[0];
  if (!res.ok || !task || task.status_code !== 20000) {
    console.error(`${provider}: ${task?.status_message || res.status}`);
    process.exit(1);
  }
  out[provider] = task.result;
  console.log(`${provider}: ${task.result.length} models`);
}

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/dataforseo/llm-models.snapshot.json');
await writeFile(target, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${target}`);

#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadTs(file, mocks = {}, cache = new Map()) {
  const abs = path.resolve(root, file);
  if (cache.has(abs)) return cache.get(abs).exports;

  const source = fs.readFileSync(abs, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      isolatedModules: false,
    },
    fileName: abs,
  });

  const mod = { exports: {} };
  cache.set(abs, mod);
  const dirname = path.dirname(abs);
  const localRequire = (specifier) => {
    if (mocks[specifier]) return mocks[specifier];
    if (specifier.startsWith('.')) {
      const target = path.resolve(dirname, specifier) + '.ts';
      return loadTs(path.relative(root, target), mocks, cache);
    }
    return require(specifier);
  };

  const wrapped = new vm.Script(
    `(function(require, module, exports, __dirname, __filename) { ${outputText}\n })`,
    { filename: abs },
  ).runInThisContext();
  wrapped(localRequire, mod, mod.exports, dirname, abs);
  return mod.exports;
}

{
  const calls = [];
  const { rewriteMeta } = loadTs('src/lib/meta-rewrite.ts', {
    './api': {
      api: async (path, options) => {
        calls.push({ path, options });
        return {
          title: 'Example service page guide',
          title_length: 26,
          description: 'Learn how Example helps teams audit meta tags and improve search snippets with practical SEO guidance.',
          description_length: 101,
          target_keyword: 'example service',
          reasoning: 'Clearer and more specific.',
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    },
    './chat': {
      getLLMConfig: () => null,
    },
  });

  await rewriteMeta({
    url: 'https://example.com/service',
    current_title: 'Service',
    current_description: null,
    issue_type: 'short_title',
  });

  assert.equal(calls.length, 1, 'rewriteMeta should call the API without a local LLM key');
  assert.equal(calls[0].path, '/api/site-audit/meta-rewrite');
  assert.equal(
    Object.hasOwn(calls[0].options.body, 'llm_config'),
    false,
    'rewriteMeta should omit llm_config when Settings has no local key',
  );
}

{
  const captured = {
    pageFetches: 0,
    llmFetches: 0,
    llmRequest: null,
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : url.url;
    if (href === 'https://example.com/service') {
      captured.pageFetches++;
      return new Response(
        '<!doctype html><html><head><title>Service</title></head><body><main><h1>Example service</h1><p>Example helps teams audit titles and meta descriptions.</p></main></body></html>',
        { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
      );
    }
    if (href === 'https://openrouter.ai/api/v1/chat/completions') {
      captured.llmFetches++;
      captured.llmRequest = {
        authorization: init?.headers?.Authorization,
        body: JSON.parse(String(init?.body || '{}')),
      };
      return new Response(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                meta_title: 'Example service meta audit guide',
                meta_description: 'Learn how Example helps teams audit title tags and meta descriptions for clearer, more clickable search snippets.',
                primary_keyword: 'example service',
                rationale: 'Uses the H1 and keeps the snippet action oriented.',
              }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 13 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };

  try {
    const { handleMetaRewrite } = loadTs('workers/src/routes/meta-rewrite.ts');
    const response = await handleMetaRewrite(
      new Request('https://worker.test/api/site-audit/meta-rewrite', {
        method: 'POST',
        body: JSON.stringify({
          url: 'https://example.com/service',
          current_title: 'Service',
          current_description: null,
          issue_type: 'short_title',
        }),
      }),
      {
        OPENROUTER_API_KEY: 'server-openrouter-key',
        ENVIRONMENT: 'development',
      },
    );
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(captured.pageFetches, 1, 'Worker should fetch page context');
    assert.equal(captured.llmFetches, 1, 'Worker should call the LLM provider');
    assert.equal(captured.llmRequest.authorization, 'Bearer server-openrouter-key');
    assert.equal(captured.llmRequest.body.model, 'deepseek/deepseek-v4-pro');
    assert.equal(body.title, 'Example service meta audit guide');
    assert.equal(body.description.includes('meta descriptions'), true);
    assert.equal(body.target_keyword, 'example service');
    assert.equal(body.reasoning, 'Uses the H1 and keeps the snippet action oriented.');
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('meta rewrite regression checks passed.');

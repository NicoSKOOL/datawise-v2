import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

const sourcePath = new URL('../src/dataforseo/client.ts', import.meta.url);
const source = readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

let currentFetch;
const module = { exports: {} };
new Script(transpiled, { filename: sourcePath.pathname }).runInNewContext({
  exports: module.exports,
  module,
  console,
  btoa,
  fetch: (...args) => currentFetch(...args),
  AbortController,
  setTimeout,
  clearTimeout,
});

const { dataforseoRequest, dataforseoGet } = module.exports;

const env = {
  DATAFORSEO_EMAIL: 'user@example.com',
  DATAFORSEO_PASSWORD: 'secret',
};

function installHangingFetch() {
  currentFetch = (_url, init = {}) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    });
}

async function assertTimesOut(operation) {
  installHangingFetch();
  const result = await Promise.race([
    operation().then(
      () => 'resolved',
      (err) => err.message
    ),
    new Promise((resolve) => setTimeout(() => resolve('hung'), 80)),
  ]);

  assert.match(result, /timed out/i);
}

await assertTimesOut(() => dataforseoRequest(env, '/slow-post', [], 25));
await assertTimesOut(() => dataforseoGet(env, '/slow-get', 25));

{
  const routeSourcePath = new URL('../src/routes/ai.ts', import.meta.url);
  const routeSource = readFileSync(routeSourcePath, 'utf8');
  const routeTranspiled = ts.transpileModule(routeSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const calls = [];
  let lighthouseShouldTimeout = false;
  const routeModule = { exports: {} };
  new Script(routeTranspiled, { filename: routeSourcePath.pathname }).runInNewContext({
    exports: routeModule.exports,
    module: routeModule,
    require: (specifier) => {
      if (specifier === '../dataforseo/client') {
        return {
          dataforseoRequest: async (_env, endpoint, body, timeoutMs) => {
            calls.push({ endpoint, body, timeoutMs });
            if (endpoint === '/on_page/lighthouse/live/json' && lighthouseShouldTimeout) {
              throw new Error('DataForSEO /on_page/lighthouse/live/json timed out after 55000ms');
            }
            if (endpoint === '/on_page/lighthouse/live/json') {
              return {
                tasks: [
                  {
                    result: [
                      {
                        categories: { seo: { score: 1 } },
                        audits: {},
                      },
                    ],
                  },
                ],
              };
            }
            return {
              tasks: [
                {
                  result: [
                    {
                      items: [
                        {
                          url: 'https://example.com/',
                          meta: {
                            title: 'Example homepage',
                            description: 'Example description',
                            htags: { h1: ['Example'] },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            };
          },
        };
      }
      throw new Error(`Unexpected require: ${specifier}`);
    },
    console,
    Request,
    Response,
    URL,
    Date,
    Set,
  });

  const response = await routeModule.exports.handleLighthouseSEO(
    new Request('https://worker.test/api/ai/lighthouse-seo', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/' }),
    }),
    env
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0].endpoint, '/on_page/lighthouse/live/json');
  assert.equal(calls[0].timeoutMs, 55_000);
  assert.equal(calls[1].endpoint, '/on_page/instant_pages');
  assert.equal(calls[1].timeoutMs, 15_000);

  calls.length = 0;
  lighthouseShouldTimeout = true;
  const fallbackResponse = await routeModule.exports.handleLighthouseSEO(
    new Request('https://worker.test/api/ai/lighthouse-seo', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/' }),
    }),
    env
  );
  assert.equal(fallbackResponse.status, 200);
  const fallbackBody = await fallbackResponse.json();
  assert.equal(fallbackBody.partial, true);
  assert.equal(fallbackBody.htmlData.title.exists, true);
  assert.equal(fallbackBody.lighthouse.audits['lighthouse-timeout'].score, 0);
}

console.log('dataforseo timeout tests passed');

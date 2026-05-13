import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = new URL('..', import.meta.url);
const tmpRoot = await mkdtemp(join(tmpdir(), 'datawise-service-page-parser-'));
await writeFile(join(tmpRoot, 'package.json'), '{"type":"module"}');

async function transpileToTemp(sourceRelative, targetRelative) {
  const sourceUrl = new URL(sourceRelative, root);
  const source = await readFile(sourceUrl, 'utf8');
  let output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  output = output
    .replaceAll("../llm/provider'", "../llm/provider.js'")
    .replaceAll('../llm/provider"', '../llm/provider.js"')
    .replaceAll("./openrouter-options'", "./openrouter-options.js'")
    .replaceAll('./openrouter-options"', './openrouter-options.js"')
    .replaceAll("../lib/safe-fetch'", "../lib/safe-fetch.js'")
    .replaceAll('../lib/safe-fetch"', '../lib/safe-fetch.js"');

  const targetPath = join(tmpRoot, targetRelative);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, output);
  return targetPath;
}

await transpileToTemp('src/llm/openrouter-options.ts', 'llm/openrouter-options.js');
await transpileToTemp('src/llm/provider.ts', 'llm/provider.js');
await transpileToTemp('src/lib/safe-fetch.ts', 'lib/safe-fetch.js');
const contentToolsPath = await transpileToTemp('src/routes/content-tools.ts', 'routes/content-tools.js');
const { parseServicePageAnalysisResponse } = await import(pathToFileURL(contentToolsPath).href);

assert.equal(typeof parseServicePageAnalysisResponse, 'function', 'parser is exported for focused validation');

const page = {
  meta_title: 'NDIS Support Services Ferntree Gully | My Inclusion',
  meta_description: 'Personalised NDIS support services for participants in Ferntree Gully.',
  word_count: 1256,
};

const completeRaw = `
Here is the analysis:
{
  "service_type": "NDIS support services",
  "industry_category": "health_wellness",
  "location": "Ferntree Gully, VIC",
  "content_score": "comprehensive",
  "content_score_pct": 82,
  "content_word_count": 1256,
  "content_gaps": [],
  "swap_test": { "score": 24, "generic_sections": [] },
  "missing_page_sections": [],
  "industry_specific_sections": [],
  "image_audit": { "has_images": true, "total_count": 4, "missing_alt_count": 0, "needs_service_area_map": false, "suggestions": [] },
  "heading_structure": { "has_h1": true, "h1_text": "NDIS Support in Ferntree Gully", "h1_includes_keyword": true, "h1_includes_location": true, "hierarchy_valid": true, "issues": [], "suggested_headings": [] },
  "cta_audit": { "ctas_found": ["Get Started Today"], "score": "strong", "suggestions": [] },
  "trust_signals": { "found": ["Phone number visible"], "missing": [], "score": "strong" },
  "tone_analysis": "Warm and practical.",
  "local_content_section": { "title": "Local access", "content": "Useful local content.", "placement": "Before FAQ" },
  "schema_existing": ["LocalBusiness", "FAQPage"],
  "schema_missing": ["Service"],
  "schema_generated": {},
  "faq": [],
  "meta_title_current": "NDIS Support Services Ferntree Gully | My Inclusion",
  "meta_title_suggested": "NDIS Support Services in Ferntree Gully | My Inclusion",
  "meta_description_current": "Personalised NDIS support services for participants in Ferntree Gully.",
  "meta_description_suggested": "Access local NDIS support coordination, hoarding recovery, and therapeutic gardening in Ferntree Gully.",
  "additional_recommendations": []
}
`;

const complete = parseServicePageAnalysisResponse(completeRaw, page, 'stop');
assert.equal(complete.service_type, 'NDIS support services');
assert.equal(complete.content_score_pct, 82);
assert.equal(complete._parse_error, undefined);
assert.equal(complete._truncated, undefined);

const truncatedRaw = `{
  "service_type": "NDIS support services",
  "industry_category": "health_wellness",
  "location": "Ferntree Gully, VIC",
  "content_score": "comprehensive",
  "content_score_pct": 82,
  "content_word_count": 1256,
  "content_gaps": [],
  "swap_test": { "score": 24, "generic_sections": [] },
  "missing_page_sections": [
`;

const truncated = parseServicePageAnalysisResponse(truncatedRaw, page, 'length');
assert.equal(truncated._truncated, true, 'truncated output is explicitly marked');
assert.match(truncated._parse_error, /truncated/i, 'parse error explains truncation');
assert.equal(truncated.content_word_count, 1256, 'fallback preserves source word count');
assert.equal(truncated.meta_title_current, page.meta_title, 'fallback preserves source metadata');

console.log('service page analysis parser validation passed');

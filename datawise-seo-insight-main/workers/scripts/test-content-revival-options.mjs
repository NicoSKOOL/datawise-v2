import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildContentRevivalRewriteInstructions,
  normalizeContentRevivalOptions,
} from '../src/content-tools/revival-options.ts';

describe('Content Revival output options', () => {
  it('defaults to TLDR, tables, FAQ, and a 65 percent capsule target', () => {
    const options = normalizeContentRevivalOptions();

    assert.equal(options.include_tldr, true);
    assert.equal(options.include_tables, true);
    assert.equal(options.include_faq, true);
    assert.equal(options.capsule_pct, 65);
    assert.equal(options.extra_instructions, '');
  });

  it('clamps capsule percentage and trims extra instructions', () => {
    const options = normalizeContentRevivalOptions({
      include_tldr: false,
      include_tables: false,
      include_faq: false,
      capsule_pct: 142.4,
      extra_instructions: '  Add a buyer checklist near the end.  ',
    });

    assert.equal(options.include_tldr, false);
    assert.equal(options.include_tables, false);
    assert.equal(options.include_faq, false);
    assert.equal(options.capsule_pct, 100);
    assert.equal(options.extra_instructions, 'Add a buyer checklist near the end.');
  });

  it('builds explicit prompt instructions for enabled and disabled sections', () => {
    const enabled = buildContentRevivalRewriteInstructions({
      include_tldr: true,
      include_tables: true,
      include_faq: true,
      capsule_pct: 70,
      extra_instructions: 'Use concise examples.',
    });

    assert.match(enabled, /TL;DR SECTION \(required\)/);
    assert.match(enabled, /TABLES \(required\)/);
    assert.match(enabled, /FAQ SECTION \(required\)/);
    assert.match(enabled, /apply to about 70% of H2 sections/);
    assert.match(enabled, /Use concise examples\./);

    const disabled = buildContentRevivalRewriteInstructions({
      include_tldr: false,
      include_tables: false,
      include_faq: false,
      capsule_pct: 0,
      extra_instructions: '',
    });

    assert.match(disabled, /Do not add a TL;DR section/);
    assert.match(disabled, /Do not add markdown tables/);
    assert.match(disabled, /Do not add a FAQ section/);
    assert.match(disabled, /Do not force capsule formatting/);
  });
});

import { describe, it, expect } from 'vitest';
import { buildBlueprintCsv, type CsvPageRow } from './report-csv';

describe('buildBlueprintCsv', () => {
  it('should output exact header row', () => {
    const rows: CsvPageRow[] = [];
    const csv = buildBlueprintCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('slug,title,page_type,primary_keyword,volume,intent,parent_slug,recommendation,priority,supporting_keywords,decision_reason,supporting_keyword_count');
  });

  it('should quote fields containing comma and quote correctly', () => {
    const rows: CsvPageRow[] = [
      {
        logicalPageId: 'page-1',
        parentLogicalPageId: null,
        pageType: 'service',
        title: 'Title with "quote" and, comma',
        slug: 'title-with-quote-and-comma',
        primaryKeyword: 'keyword',
        primaryVolume: 100,
        primaryIntent: 'commercial',
        recommendation: 'add',
        approval: 'approved',
        priority: 'high',
        confidenceLabel: 'high',
        supportingKeywordCount: 5,
        supportingKeywords: [],
        parentSlug: null,
        decisionReason: null,
      },
    ];
    const csv = buildBlueprintCsv(rows);
    const lines = csv.split('\r\n');
    expect(lines[1]).toContain('"Title with ""quote"" and, comma"');
  });

  it('should convert null values to empty fields', () => {
    const rows: CsvPageRow[] = [
      {
        logicalPageId: 'page-1',
        parentLogicalPageId: null,
        pageType: 'service',
        title: 'Test Page',
        slug: 'test-page',
        primaryKeyword: null,
        primaryVolume: null,
        primaryIntent: null,
        recommendation: 'add',
        approval: 'pending',
        priority: null,
        confidenceLabel: null,
        supportingKeywordCount: 0,
        supportingKeywords: [],
        parentSlug: null,
        decisionReason: null,
      },
    ];
    const csv = buildBlueprintCsv(rows);
    const lines = csv.split('\r\n');
    // Should have empty fields for null values
    expect(lines[1]).toMatch(/^test-page,Test Page,service,,,/);
  });

  it('should produce deterministic output for same input', () => {
    const rows: CsvPageRow[] = [
      {
        logicalPageId: 'page-1',
        parentLogicalPageId: null,
        pageType: 'service',
        title: 'Home',
        slug: 'home',
        primaryKeyword: 'keyword',
        primaryVolume: 100,
        primaryIntent: 'informational',
        recommendation: 'add',
        approval: 'approved',
        priority: 'high',
        confidenceLabel: 'high',
        supportingKeywordCount: 3,
        supportingKeywords: [],
        parentSlug: null,
        decisionReason: 'Primary landing page',
      },
    ];
    const csv1 = buildBlueprintCsv(rows);
    const csv2 = buildBlueprintCsv(rows);
    expect(csv1).toBe(csv2);
  });

  it('should use CRLF line endings', () => {
    const rows: CsvPageRow[] = [
      {
        logicalPageId: 'page-1',
        parentLogicalPageId: null,
        pageType: 'service',
        title: 'Test',
        slug: 'test',
        primaryKeyword: 'test keyword',
        primaryVolume: 50,
        primaryIntent: 'informational',
        recommendation: 'add',
        approval: 'approved',
        priority: 'medium',
        confidenceLabel: 'medium',
        supportingKeywordCount: 2,
        supportingKeywords: [],
        parentSlug: null,
        decisionReason: null,
      },
    ];
    const csv = buildBlueprintCsv(rows);
    expect(csv).toContain('\r\n');
    expect(csv).not.toContain('\n\n');
  });
});

describe('buildBlueprintCsv supporting keywords column (pp-v3)', () => {
  const base = {
    logicalPageId: 'page-1',
    parentLogicalPageId: null,
    pageType: 'service',
    title: 'Drain Cleaning',
    slug: '/services/drain-cleaning/',
    primaryKeyword: 'drain cleaning',
    primaryVolume: 90500,
    primaryIntent: 'commercial',
    recommendation: 'add',
    approval: 'approved',
    priority: 'high',
    confidenceLabel: 'high',
    parentSlug: null,
    decisionReason: null,
  };

  it('emits a pipe-separated keyword list capped at the export cap, count in the trailing column', () => {
    const many = Array.from({ length: 14 }, (_, i) => `kw ${i + 1}`);
    const rows: CsvPageRow[] = [{ ...base, supportingKeywordCount: 14, supportingKeywords: many }];
    const csv = buildBlueprintCsv(rows);
    const line = csv.split('\r\n')[1];
    const fields = line.split(',').map((f) => f.replace(/^"|"$/g, ''));
    expect(fields[9]).toBe(many.slice(0, 10).join('|'));
    expect(fields[11]).toBe('14');
  });

  it('emits empty list and zero count for skeleton pages', () => {
    const rows: CsvPageRow[] = [{ ...base, supportingKeywordCount: 0, supportingKeywords: [] }];
    const line = buildBlueprintCsv(rows).split('\r\n')[1];
    const fields = line.split(',');
    expect(fields[9]).toBe('');
    expect(fields[11]).toBe('0');
  });
});

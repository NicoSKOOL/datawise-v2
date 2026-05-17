#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDir, '..');

async function source(relativePath) {
  return readFile(path.join(appRoot, relativePath), 'utf8');
}

function includes(haystack, needle, label) {
  assert.equal(haystack.includes(needle), true, `${label} missing: ${needle}`);
}

function excludes(haystack, needle, label) {
  assert.equal(haystack.includes(needle), false, `${label} should not include: ${needle}`);
}

const siteAuditPage = await source('src/pages/SiteAudit.tsx');
excludes(siteAuditPage, 'defaultDomain', 'Site Audit domain input autofill');
excludes(siteAuditPage, 'placeholder="yourdomain.com"', 'Site Audit domain input placeholder');
includes(siteAuditPage, 'Crawled pages', 'Site Audit crawled pages report section');
includes(siteAuditPage, 'audit?.seo_analysis?.crawled_pages', 'Site Audit crawled pages data source');

const siteAuditTypes = await source('src/lib/site-audit.ts');
includes(siteAuditTypes, 'export interface CrawledPageSummary', 'Crawled page report type');
includes(siteAuditTypes, 'crawled_pages?: CrawledPageSummary[];', 'Structured SEO crawled pages field');

console.log('site-audit UI regression checks passed.');

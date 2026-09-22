import { describe, it, expect } from 'vitest';
import { parseMeta, detectClientRendered } from './meta-checker';

describe('parseMeta', () => {
  it('reads title and description from <head> (classic SSR)', () => {
    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <title>My Page Title</title>
      <meta name="description" content="A normal meta description that is here.">
    </head><body><h1>Hi</h1></body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBe('My Page Title');
    expect(r.description).toBe('A normal meta description that is here.');
  });

  // Regression: Next.js 15.2+ "streaming metadata" — for non-bot UAs Next streams
  // <title>/<meta> into the <body> (after </head>) and React hoists them client
  // side. The head-only scan reported these real titles as "missing" (bug
  // 176b0fb6, "26 missing titles" false positive on a Next 16 site, 2026-06-16).
  it('falls back to the body when metadata is streamed after </head>', () => {
    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <link rel="preload" href="/_next/static/x.js" as="script">
    </head><body>
      <div id="__next">content</div>
      <title>Streamed Page Title</title>
      <meta name="description" content="Streamed meta description text.">
    </body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBe('Streamed Page Title');
    expect(r.description).toBe('Streamed meta description text.');
  });

  it('prefers the <head> title over any later <title> in the body', () => {
    const html = `<!DOCTYPE html><html><head><title>Real Head Title</title></head>
      <body><svg><title>icon label</title></svg></body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBe('Real Head Title');
  });

  it('ignores an SVG <title> in the body when no head title exists', () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
      <body><svg viewBox="0 0 10 10"><title>close icon</title></svg>
      <p>No real page title anywhere.</p></body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBeNull();
  });

  it('ignores a <title> that only appears inside an HTML comment', () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
      <body><!-- example: <title>Not the title</title> --><p>body</p></body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBeNull();
  });

  it('returns nulls when title and description are genuinely absent', () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>x</p></body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBeNull();
    expect(r.description).toBeNull();
  });
});

// Bug b432e6c3: a client-rendered React SPA (hakorisk.com) serves an empty
// shell, so the plain fetch finds no title/description while Site Audit (JS
// rendering) sees them. detectClientRendered lets the UI explain why.
describe('detectClientRendered', () => {
  it('flags an empty-root SPA shell with a module script', () => {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <script type="module" crossorigin src="/assets/index-abc123.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-def456.css">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/main.js"></script>
  </body>
</html>`;
    expect(parseMeta(html)).toEqual({ title: null, description: null });
    expect(detectClientRendered(html)).toBe(true);
  });

  it('does not flag a normal page with title and description', () => {
    const html = `<!DOCTYPE html><html><head>
      <title>Roofing Services in Austin</title>
      <meta name="description" content="Licensed roofers serving Austin since 1998.">
      <script type="module" src="/assets/main.js"></script>
    </head><body><div id="root"></div></body></html>`;
    expect(detectClientRendered(html)).toBe(false);
  });

  it('does not flag a server-rendered page missing a description but with real content', () => {
    const paragraph =
      'We repair and replace residential roofs across the metro area, with free inspections, ' +
      'written estimates, and a ten year workmanship warranty on every job we complete. ';
    const html = `<!DOCTYPE html><html><head>
      <script src="/assets/app.js"></script>
    </head><body>
      <div id="app"><h1>Roof Repair</h1><p>${paragraph}</p><p>${paragraph}</p></div>
    </body></html>`;
    expect(parseMeta(html).description).toBeNull();
    expect(detectClientRendered(html)).toBe(false);
  });
});

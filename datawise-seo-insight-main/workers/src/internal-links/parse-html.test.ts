import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { canon, parsePage } from './parse-html';

// Real pages saved as fixtures, with crawl.py parse() (BeautifulSoup + lxml)
// output on the same HTML as the expected value.
const dir = path.join(__dirname, '__fixtures__', 'html');
const pages = readdirSync(dir)
  .filter((f) => f.endsWith('.html'))
  .map((f) => f.replace(/\.html$/, ''));

describe('parsePage (parity with crawl.py)', () => {
  it.each(pages)('%s', (name) => {
    const url = readFileSync(path.join(dir, `${name}.url`), 'utf8').trim();
    const html = readFileSync(path.join(dir, `${name}.html`), 'utf8');
    const expected = JSON.parse(readFileSync(path.join(dir, `${name}.expected.json`), 'utf8'));
    expect(parsePage(url, html)).toEqual(expected);
  });
});

describe('parsePage edge cases', () => {
  const long = 'x'.repeat(130);
  it('skips paragraphs with links, removed regions and short text', () => {
    const html = `<html lang="en-GB"><head><title>T</title></head><body>
      <header><h1>Hidden</h1></header><nav><p>${long}</p></nav>
      <p>${long}</p><p>short</p><p>${long} <a href="/a">x</a></p>
      <ul><li>first ${long}<li>second ${long}</ul></body></html>`;
    const p = parsePage('https://www.site.com/page', html);
    expect(p.lang).toBe('en');
    expect(p.h1).toBe('');
    expect(p.passages.map((x) => x.text.slice(0, 6))).toEqual(['xxxxxx', 'first ', 'second']);
    expect(p.outlinks).toEqual(['site.com/a/']);
  });

  it('joins inline text with spaces like get_text(" ", strip=True)', () => {
    const html = `<main><p>${long}<b>bold</b>tail &amp; more</p></main>`;
    expect(parsePage('https://s.com/', html).passages[0].text).toBe(`${long} bold tail & more`);
  });

  it('canon strips scheme, www and query, adds trailing slash', () => {
    expect(canon('https://www.site.com/a/b?x=1#y')).toBe('site.com/a/b/');
    expect(canon('http://site.com')).toBe('site.com/');
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readerUrl, tryHtmlBruteforce } from '../src/platforms/fallback/index.ts';

test('readerUrl prefixes target URL for Jina Reader', () => {
  assert.equal(
    readerUrl('https://example.com/a?x=1'),
    'https://r.jina.ai/http://https://example.com/a?x=1',
  );
});

test('tryHtmlBruteforce converts direct HTML into a fallback article', () => {
  const html = `<!doctype html><html><head><title>Demo Page</title><script>bad()</script></head><body><main><h1>Demo</h1><p>${'hello world '.repeat(30)}</p></main></body></html>`;
  const article = tryHtmlBruteforce(html, 'https://example.com/demo');
  assert.ok(article);
  assert.equal(article?.source, 'html-bruteforce');
  assert.equal(article?.title, 'Demo Page');
  assert.match(article?.contentMarkdown ?? '', /# Demo/);
  assert.doesNotMatch(article?.contentMarkdown ?? '', /bad/);
});

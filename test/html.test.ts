import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTags, decodeEntities, htmlToMarkdown } from '../src/core/html.ts';

test('stripTags removes tags', () => {
  assert.equal(stripTags('<p>hello <b>world</b></p>'), 'hello world');
});

test('decodeEntities handles common entities', () => {
  assert.equal(decodeEntities('A &amp; B &lt;c&gt; &#39;x&#39; &nbsp;&quot;y&quot;'),
    `A & B <c> 'x'  "y"`);
  assert.equal(decodeEntities('&#x4e2d;&#x6587;'), '中文');
});

test('htmlToMarkdown: headings', () => {
  const md = htmlToMarkdown('<h1>Title</h1><h2>Sub</h2>');
  assert.match(md, /# Title/);
  assert.match(md, /## Sub/);
});

test('htmlToMarkdown: bold / italic / code / link', () => {
  const md = htmlToMarkdown('<strong>bold</strong> <em>em</em> <code>c</code> <a href="https://x">L</a>');
  assert.match(md, /\*\*bold\*\*/);
  assert.match(md, /\*em\*/);
  assert.match(md, /`c`/);
  assert.match(md, /\[L\]\(https:\/\/x\)/);
});

test('htmlToMarkdown: image with data-src preferred over src', () => {
  const md = htmlToMarkdown('<img data-src="real.jpg" src="placeholder.jpg" alt="A"/>');
  assert.match(md, /!\[A\]\(real\.jpg\)/);
});

test('htmlToMarkdown: code block', () => {
  const md = htmlToMarkdown('<pre><code>const x = 1;</code></pre>');
  assert.match(md, /```[\s\S]*const x = 1;[\s\S]*```/);
});

test('htmlToMarkdown: strips script and style', () => {
  const md = htmlToMarkdown('<script>evil()</script><style>.x{}</style><p>safe</p>');
  assert.doesNotMatch(md, /evil/);
  assert.doesNotMatch(md, /\.x\{/);
  assert.match(md, /safe/);
});

test('htmlToMarkdown: list', () => {
  const md = htmlToMarkdown('<ul><li>a</li><li>b</li></ul>');
  assert.match(md, /- a/);
  assert.match(md, /- b/);
});

test('htmlToMarkdown: ordered list', () => {
  const md = htmlToMarkdown('<ol><li>a</li><li>b</li></ol>');
  assert.match(md, /1\. a/);
  assert.match(md, /2\. b/);
});

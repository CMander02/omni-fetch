import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, toJSON } from '../src/core/render.ts';
import type { FetchResult } from '../src/core/types.ts';

const sample: FetchResult = {
  platform: 'wechat',
  url: 'https://mp.weixin.qq.com/s/abc',
  title: 'Test Title',
  fetched_at: '2026-05-23T00:00:00.000Z',
  meta: {
    source: 'wechat',
    author: 'Alice',
    publish_time: '2026-05-23 10:00:00',
    description: 'A short desc',
    tags: ['tech', 'AI'],
  },
  body_markdown: 'Hello **world**.',
  media: [{ url: 'https://x/cover.jpg', type: 'image', filename: 'cover.jpg' }],
};

test('toMarkdown emits YAML frontmatter with key fields', () => {
  const md = toMarkdown(sample);
  assert.match(md, /^---\n/);
  assert.match(md, /title: "?Test Title"?/);
  assert.match(md, /url: https:\/\/mp\.weixin\.qq\.com\/s\/abc/);
  assert.match(md, /source: wechat/);
  assert.match(md, /author: Alice/);
  assert.match(md, /tags:\n  - tech\n  - AI/);
  assert.match(md, /\n---\n/);
});

test('toMarkdown body contains title heading and body content', () => {
  const md = toMarkdown(sample);
  assert.match(md, /# Test Title/);
  assert.match(md, /> A short desc/);
  assert.match(md, /Hello \*\*world\*\*\./);
});

test('toMarkdown header shows author and publish time', () => {
  const md = toMarkdown(sample);
  // Wechat sample has author=Alice, publish_time=2026-05-23 10:00:00
  assert.match(md, /\*\*作者\*\*:.*Alice/);
  assert.match(md, /\*\*发布\*\*: 2026-05-23 10:00:00/);
});

test('toMarkdown header: xhs-style author with id and profile link', () => {
  const md = toMarkdown({
    ...sample,
    platform: 'rednote',
    meta: {
      source: 'rednote',
      author: '初祥祥',
      author_id: '62182c3d000000001000f5e7',
      author_profile: 'https://www.xiaohongshu.com/user/profile/62182c3d000000001000f5e7',
      publish_time: '2026/05/22 18:46:04',
      desc: 'A xhs note',
    },
  });
  assert.match(md, /\[初祥祥\]\(https:\/\/www\.xiaohongshu\.com\/user\/profile\/62182c3d000000001000f5e7\)/);
  assert.match(md, /\(62182c3d000000001000f5e7\)/);
  assert.match(md, /\*\*发布\*\*: 2026\/05\/22 18:46:04/);
});

test('toMarkdown header: no author/time → no meta line', () => {
  const md = toMarkdown({
    ...sample,
    meta: { source: 'wechat', title: 'X' },
  });
  assert.doesNotMatch(md, /\*\*作者\*\*/);
  assert.doesNotMatch(md, /\*\*发布\*\*/);
});

test('toMarkdown: appends media summary section when media present', () => {
  const md = toMarkdown(sample);
  // sample has 1 media item (cover.jpg)
  assert.match(md, /## 多媒体内容/);
  assert.match(md, /https:\/\/x\/cover\.jpg/);
  // The summary should mention type and filename for orientation
  assert.match(md, /image/);
  assert.match(md, /cover\.jpg/);
});

test('toMarkdown: no media → no media section', () => {
  const md = toMarkdown({ ...sample, media: [] });
  assert.doesNotMatch(md, /## 多媒体内容/);
});

test('toMarkdown: multiple media listed individually', () => {
  const md = toMarkdown({
    ...sample,
    media: [
      { url: 'https://x/a.jpg', type: 'image', filename: 'a.jpg' },
      { url: 'https://x/b.mp4', type: 'video', filename: 'b.mp4', quality: '720P' },
      { url: 'https://x/c.m4a', type: 'audio', filename: 'c.m4a' },
    ],
  });
  assert.match(md, /a\.jpg/);
  assert.match(md, /b\.mp4/);
  assert.match(md, /c\.m4a/);
  assert.match(md, /720P/);
});

test('toJSON: media field present (already; this test pins behavior)', () => {
  const json = JSON.parse(toJSON(sample));
  assert.ok(Array.isArray(json.media));
  assert.equal(json.media.length, 1);
  assert.equal(json.media[0].url, 'https://x/cover.jpg');
});

test('toJSON returns string with full main info', () => {
  const json = toJSON(sample);
  const parsed = JSON.parse(json);
  assert.equal(parsed.title, 'Test Title');
  assert.equal(parsed.source, 'wechat');
  assert.equal(parsed.author, 'Alice');
  assert.equal(parsed.body_markdown, 'Hello **world**.');
  assert.equal(parsed.media[0].url, 'https://x/cover.jpg');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../src/detect.ts';
import { parsePixivUrl } from '../src/platforms/pixiv/detect.ts';

test('detect: pixiv artwork URL', () => {
  assert.equal(detectPlatform('https://www.pixiv.net/artworks/12345'), 'pixiv');
  assert.equal(detectPlatform('https://www.pixiv.net/en/artworks/12345'), 'pixiv');
});

test('detect: pixiv user URL', () => {
  assert.equal(detectPlatform('https://www.pixiv.net/users/12345'), 'pixiv');
  assert.equal(detectPlatform('https://www.pixiv.net/users/12345/artworks'), 'pixiv');
  assert.equal(detectPlatform('https://www.pixiv.net/en/users/12345'), 'pixiv');
});

test('detect: pixiv novel URL', () => {
  assert.equal(detectPlatform('https://www.pixiv.net/novel/show.php?id=12345'), 'pixiv');
  assert.equal(detectPlatform('https://www.pixiv.net/novel/show.php?id=99999&abc=1'), 'pixiv');
});

test('detect: pixiv short link', () => {
  // legacy member_illust.php?mode=medium&illust_id=X
  assert.equal(detectPlatform('https://www.pixiv.net/member_illust.php?mode=medium&illust_id=12345'), 'pixiv');
});

test('parsePixivUrl: artwork', () => {
  assert.deepEqual(parsePixivUrl('https://www.pixiv.net/artworks/100'), { kind: 'artwork', id: '100' });
  assert.deepEqual(parsePixivUrl('https://www.pixiv.net/en/artworks/100'), { kind: 'artwork', id: '100' });
});

test('parsePixivUrl: user (with or without /artworks suffix)', () => {
  assert.deepEqual(parsePixivUrl('https://www.pixiv.net/users/42'), { kind: 'user', id: '42' });
  assert.deepEqual(parsePixivUrl('https://www.pixiv.net/users/42/artworks'), { kind: 'user', id: '42' });
  assert.deepEqual(parsePixivUrl('https://www.pixiv.net/en/users/42/artworks'), { kind: 'user', id: '42' });
});

test('parsePixivUrl: novel via show.php', () => {
  assert.deepEqual(parsePixivUrl('https://www.pixiv.net/novel/show.php?id=12345'), { kind: 'novel', id: '12345' });
});

test('parsePixivUrl: legacy member_illust.php', () => {
  assert.deepEqual(parsePixivUrl('https://www.pixiv.net/member_illust.php?mode=medium&illust_id=999'),
    { kind: 'artwork', id: '999' });
});

test('parsePixivUrl: garbage → null', () => {
  assert.equal(parsePixivUrl('https://example.com'), null);
  assert.equal(parsePixivUrl(''), null);
  assert.equal(parsePixivUrl('https://www.pixiv.net/'), null);
});

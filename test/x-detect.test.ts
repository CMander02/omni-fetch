import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../src/detect.ts';
import { parseXUrl } from '../src/platforms/x/index.ts';

test('detect: x.com user page', () => {
  assert.equal(detectPlatform('https://x.com/elonmusk'), 'x');
  assert.equal(detectPlatform('https://www.x.com/elonmusk'), 'x');
});

test('detect: twitter.com user page', () => {
  assert.equal(detectPlatform('https://twitter.com/elonmusk'), 'x');
  assert.equal(detectPlatform('https://mobile.twitter.com/jack'), 'x');
});

test('detect: status URL', () => {
  assert.equal(detectPlatform('https://x.com/elonmusk/status/123'), 'x');
  assert.equal(detectPlatform('https://twitter.com/elonmusk/status/123'), 'x');
});

test('parseXUrl: user page (no status)', () => {
  const r = parseXUrl('https://x.com/elonmusk');
  assert.deepEqual(r, { kind: 'user', handle: 'elonmusk' });
});

test('parseXUrl: with_replies normalized to user page', () => {
  const r = parseXUrl('https://x.com/paulg/with_replies');
  assert.deepEqual(r, { kind: 'user', handle: 'paulg' });
});

test('parseXUrl: status URL extracts handle + id', () => {
  const r = parseXUrl('https://x.com/elonmusk/status/2057327547411570907');
  assert.deepEqual(r, { kind: 'status', handle: 'elonmusk', statusId: '2057327547411570907' });
});

test('parseXUrl: twitter.com mapped to same handle', () => {
  const r = parseXUrl('https://twitter.com/sama/status/12345');
  assert.deepEqual(r, { kind: 'status', handle: 'sama', statusId: '12345' });
});

test('parseXUrl: reserved paths (home, search) → null', () => {
  assert.equal(parseXUrl('https://x.com/home'), null);
  assert.equal(parseXUrl('https://x.com/search?q=foo'), null);
  assert.equal(parseXUrl('https://x.com/explore'), null);
  assert.equal(parseXUrl('https://x.com/i/lists/123'), null);
});

test('parseXUrl: garbage → null', () => {
  assert.equal(parseXUrl('https://example.com/foo'), null);
  assert.equal(parseXUrl(''), null);
});

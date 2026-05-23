import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../src/detect.ts';
import { parseHnUrl } from '../src/platforms/hackernews/detect.ts';

test('detect: hn item URL', () => {
  assert.equal(detectPlatform('https://news.ycombinator.com/item?id=12345'), 'hackernews');
  assert.equal(detectPlatform('http://news.ycombinator.com/item?id=1'), 'hackernews');
});

test('detect: hn user URL', () => {
  assert.equal(detectPlatform('https://news.ycombinator.com/user?id=pg'), 'hackernews');
});

test('detect: hn front page (no id) → still hackernews', () => {
  assert.equal(detectPlatform('https://news.ycombinator.com/'), 'hackernews');
});

test('parseHnUrl: item', () => {
  assert.deepEqual(parseHnUrl('https://news.ycombinator.com/item?id=12345'),
    { kind: 'item', id: '12345' });
});

test('parseHnUrl: user', () => {
  assert.deepEqual(parseHnUrl('https://news.ycombinator.com/user?id=pg'),
    { kind: 'user', id: 'pg' });
});

test('parseHnUrl: garbage → null', () => {
  assert.equal(parseHnUrl('https://example.com'), null);
  assert.equal(parseHnUrl(''), null);
});

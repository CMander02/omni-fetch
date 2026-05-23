import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectThread, type XTweet } from '../src/platforms/x/index.ts';

function t(id: string, handle: string, text = ''): XTweet {
  return { statusId: id, handle, text, time: '2026-01-01T00:00:00.000Z' };
}

test('collectThread: single tweet (no follow-up) → 1 tweet', () => {
  const tweets = [t('1', 'alice', 'hello')];
  assert.deepEqual(collectThread(tweets, '1').map(x => x.statusId), ['1']);
});

test('collectThread: same author replies in order → full thread', () => {
  const tweets = [
    t('1', 'alice', 'first'),
    t('2', 'alice', 'second'),
    t('3', 'alice', 'third'),
  ];
  assert.deepEqual(collectThread(tweets, '1').map(x => x.statusId), ['1', '2', '3']);
});

test('collectThread: stops at first other-author reply', () => {
  const tweets = [
    t('1', 'alice', 'first'),
    t('2', 'alice', 'second'),
    t('3', 'bob', 'random reply'),
    t('4', 'alice', 'late self-reply — not included since bob broke the chain'),
  ];
  const ids = collectThread(tweets, '1').map(x => x.statusId);
  assert.deepEqual(ids, ['1', '2']);
});

test('collectThread: main tweet not first in array', () => {
  // Could happen if "Replying to ..." parent tweet is above the main one
  const tweets = [
    t('0', 'someone-else', 'parent'),
    t('1', 'alice', 'main'),
    t('2', 'alice', 'second'),
  ];
  assert.deepEqual(collectThread(tweets, '1').map(x => x.statusId), ['1', '2']);
});

test('collectThread: case-insensitive handle match', () => {
  const tweets = [
    t('1', 'Alice', 'first'),
    t('2', 'alice', 'second'),
    t('3', 'ALICE', 'third'),
  ];
  assert.deepEqual(collectThread(tweets, '1').map(x => x.statusId), ['1', '2', '3']);
});

test('collectThread: empty input → empty result', () => {
  assert.deepEqual(collectThread([], '999'), []);
});

test('collectThread: missing main status id → falls back to first tweet', () => {
  const tweets = [t('1', 'alice'), t('2', 'alice')];
  // Caller passed a status id not in the array — collect from index 0
  assert.deepEqual(collectThread(tweets, '999').map(x => x.statusId), ['1', '2']);
});

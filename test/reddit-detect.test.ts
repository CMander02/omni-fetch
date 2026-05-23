import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../src/detect.ts';
import { parseRedditUrl } from '../src/platforms/reddit/detect.ts';

test('detect: reddit post URL', () => {
  assert.equal(detectPlatform('https://www.reddit.com/r/programming/comments/abc/title/'), 'reddit');
  assert.equal(detectPlatform('https://old.reddit.com/r/programming/comments/abc/title'), 'reddit');
  assert.equal(detectPlatform('https://reddit.com/r/programming/comments/abc'), 'reddit');
});

test('detect: reddit subreddit URL', () => {
  assert.equal(detectPlatform('https://www.reddit.com/r/programming/'), 'reddit');
  assert.equal(detectPlatform('https://www.reddit.com/r/programming/top/?t=week'), 'reddit');
});

test('detect: reddit user URL', () => {
  assert.equal(detectPlatform('https://www.reddit.com/user/spez'), 'reddit');
  assert.equal(detectPlatform('https://www.reddit.com/u/spez'), 'reddit');
});

test('detect: redd.it short link', () => {
  assert.equal(detectPlatform('https://redd.it/abc123'), 'reddit');
});

test('parseRedditUrl: post', () => {
  const r = parseRedditUrl('https://www.reddit.com/r/programming/comments/1abc/some_title/');
  assert.deepEqual(r, { kind: 'post', subreddit: 'programming', postId: '1abc' });
});

test('parseRedditUrl: post without trailing slug', () => {
  const r = parseRedditUrl('https://reddit.com/r/golang/comments/xyz');
  assert.deepEqual(r, { kind: 'post', subreddit: 'golang', postId: 'xyz' });
});

test('parseRedditUrl: subreddit', () => {
  const r = parseRedditUrl('https://www.reddit.com/r/programming/');
  assert.deepEqual(r, { kind: 'subreddit', subreddit: 'programming' });
});

test('parseRedditUrl: user', () => {
  assert.deepEqual(parseRedditUrl('https://www.reddit.com/user/spez'), { kind: 'user', userId: 'spez' });
  assert.deepEqual(parseRedditUrl('https://www.reddit.com/u/spez'), { kind: 'user', userId: 'spez' });
});

test('parseRedditUrl: redd.it short link', () => {
  assert.deepEqual(parseRedditUrl('https://redd.it/abc123'), { kind: 'post-short', postId: 'abc123' });
});

test('parseRedditUrl: garbage → null', () => {
  assert.equal(parseRedditUrl('https://example.com'), null);
  assert.equal(parseRedditUrl(''), null);
});

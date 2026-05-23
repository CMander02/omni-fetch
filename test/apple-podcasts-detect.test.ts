import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../src/detect.ts';
import { parseApplePodcastsUrl } from '../src/platforms/apple-podcasts/detect.ts';

test('detect: apple podcasts episode URL', () => {
  assert.equal(detectPlatform('https://podcasts.apple.com/cn/podcast/some-slug/id1634356920?i=1000765020256'), 'apple-podcasts');
  assert.equal(detectPlatform('https://podcasts.apple.com/us/podcast/show/id123?i=456'), 'apple-podcasts');
});

test('detect: apple podcasts show URL (no ?i=)', () => {
  assert.equal(detectPlatform('https://podcasts.apple.com/cn/podcast/some-slug/id1634356920'), 'apple-podcasts');
});

test('parseApplePodcastsUrl: episode URL → collectionId + episodeId', () => {
  const r = parseApplePodcastsUrl('https://podcasts.apple.com/cn/podcast/x/id1634356920?i=1000765020256');
  assert.deepEqual(r, { kind: 'episode', collectionId: '1634356920', episodeId: '1000765020256', country: 'cn' });
});

test('parseApplePodcastsUrl: show URL → just collectionId', () => {
  const r = parseApplePodcastsUrl('https://podcasts.apple.com/us/podcast/x/id1634356920');
  assert.deepEqual(r, { kind: 'show', collectionId: '1634356920', country: 'us' });
});

test('parseApplePodcastsUrl: URL with extra params', () => {
  const r = parseApplePodcastsUrl('https://podcasts.apple.com/jp/podcast/abc/id999?i=111&utm=foo');
  assert.deepEqual(r, { kind: 'episode', collectionId: '999', episodeId: '111', country: 'jp' });
});

test('parseApplePodcastsUrl: garbage → null', () => {
  assert.equal(parseApplePodcastsUrl('https://example.com/foo'), null);
  assert.equal(parseApplePodcastsUrl(''), null);
  assert.equal(parseApplePodcastsUrl('https://podcasts.apple.com/cn/podcast/no-id-here'), null);
});

test('parseApplePodcastsUrl: missing country still works (defaults to us)', () => {
  // Some legacy URLs omit the country segment
  const r = parseApplePodcastsUrl('https://podcasts.apple.com/podcast/x/id1234?i=5678');
  assert.deepEqual(r, { kind: 'episode', collectionId: '1234', episodeId: '5678', country: 'us' });
});

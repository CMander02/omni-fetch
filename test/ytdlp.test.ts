import { test } from 'node:test';
import assert from 'node:assert/strict';
import { srtToPlainText } from '../src/core/ytdlp.ts';

test('srtToPlainText strips indices and timestamps', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000
Hello world

2
00:00:04,000 --> 00:00:06,500
Second line
continued
`;
  const out = srtToPlainText(srt);
  assert.doesNotMatch(out, /-->/);
  assert.doesNotMatch(out, /^\d+$/m);
  assert.match(out, /Hello world/);
  assert.match(out, /Second line/);
  assert.match(out, /continued/);
});

test('srtToPlainText handles empty input', () => {
  assert.equal(srtToPlainText(''), '');
});

test('srtToPlainText collapses consecutive blanks', () => {
  const srt = `1
00:00:01,000 --> 00:00:03,000
A

2
00:00:04,000 --> 00:00:06,000
B
`;
  const out = srtToPlainText(srt);
  assert.doesNotMatch(out, /\n{3,}/);
});

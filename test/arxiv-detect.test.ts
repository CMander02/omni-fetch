import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../src/detect.ts';
import { parseArxivId } from '../src/platforms/arxiv/detect.ts';

test('detect: arxiv abs URL', () => {
  assert.equal(detectPlatform('https://arxiv.org/abs/2401.12345'), 'arxiv');
  assert.equal(detectPlatform('http://arxiv.org/abs/2401.12345v2'), 'arxiv');
  assert.equal(detectPlatform('https://www.arxiv.org/abs/2401.12345'), 'arxiv');
});

test('detect: arxiv pdf URL', () => {
  assert.equal(detectPlatform('https://arxiv.org/pdf/2401.12345'), 'arxiv');
  assert.equal(detectPlatform('https://arxiv.org/pdf/2401.12345.pdf'), 'arxiv');
  assert.equal(detectPlatform('https://arxiv.org/pdf/2401.12345v3.pdf'), 'arxiv');
});

test('detect: bare new-style ID', () => {
  assert.equal(detectPlatform('2401.12345'), 'arxiv');
  assert.equal(detectPlatform('2401.12345v2'), 'arxiv');
  assert.equal(detectPlatform('1706.03762'), 'arxiv');
});

test('detect: arxiv: prefix', () => {
  assert.equal(detectPlatform('arxiv:2401.12345'), 'arxiv');
  assert.equal(detectPlatform('arXiv:2401.12345v2'), 'arxiv');
});

test('detect: old-style IDs no longer recognized', () => {
  assert.equal(detectPlatform('cs.AI/0301001'), null);
  assert.equal(detectPlatform('cs/0301001v1'), null);
});

test('detect: ambiguous bare IDs are NOT confused with other platforms', () => {
  assert.equal(detectPlatform('BV1GJ411x7h7'), 'bilibili');
  assert.equal(detectPlatform('2401'), null);
  assert.equal(detectPlatform('12345'), null);
});

test('parseArxivId: new-style normalization', () => {
  assert.deepEqual(parseArxivId('2401.12345'), { id: '2401.12345', version: '' });
  assert.deepEqual(parseArxivId('2401.12345v2'), { id: '2401.12345', version: 'v2' });
});

test('parseArxivId: 4-digit suffix also valid (pre-2015 papers)', () => {
  // arxiv new scheme started 2007 with 4-digit suffix, expanded to 5 in 2015
  assert.deepEqual(parseArxivId('0706.0001'), { id: '0706.0001', version: '' });
  assert.deepEqual(parseArxivId('1411.1784v1'), { id: '1411.1784', version: 'v1' });
});

test('parseArxivId: extracts from abs URL', () => {
  assert.deepEqual(parseArxivId('https://arxiv.org/abs/2401.12345v3'), { id: '2401.12345', version: 'v3' });
  assert.deepEqual(parseArxivId('https://arxiv.org/abs/1706.03762'), { id: '1706.03762', version: '' });
});

test('parseArxivId: extracts from pdf URL', () => {
  assert.deepEqual(parseArxivId('https://arxiv.org/pdf/2401.12345.pdf'), { id: '2401.12345', version: '' });
  assert.deepEqual(parseArxivId('https://arxiv.org/pdf/2401.12345v2'), { id: '2401.12345', version: 'v2' });
  assert.deepEqual(parseArxivId('https://arxiv.org/pdf/2401.12345v3.pdf'), { id: '2401.12345', version: 'v3' });
});

test('parseArxivId: arxiv: prefix', () => {
  assert.deepEqual(parseArxivId('arXiv:2401.12345v2'), { id: '2401.12345', version: 'v2' });
});

test('parseArxivId: garbage → null', () => {
  assert.equal(parseArxivId('not-a-paper'), null);
  assert.equal(parseArxivId(''), null);
  assert.equal(parseArxivId('https://example.com/foo'), null);
  assert.equal(parseArxivId('cs.AI/0301001'), null);
});

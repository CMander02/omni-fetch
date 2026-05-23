import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTime, type TimeConfig } from '../src/core/time-config.ts';

const T = new Date('2026-05-24T08:45:00Z');

test('renderTime: compact UTC (default)', () => {
  const cfg: TimeConfig = { timezone: 'UTC', format: 'compact', showOffset: false };
  assert.equal(renderTime(T, cfg), '20260524T084500Z');
});

test('renderTime: compact with non-UTC zone uses offset', () => {
  const cfg: TimeConfig = { timezone: 'Asia/Shanghai', format: 'compact', showOffset: false };
  assert.equal(renderTime(T, cfg), '20260524T164500+0800');
});

test('renderTime: loose no-offset (UTC zone)', () => {
  const cfg: TimeConfig = { timezone: 'UTC', format: 'loose', showOffset: false };
  assert.equal(renderTime(T, cfg), '2026-05-24 08:45:00');
});

test('renderTime: loose with offset', () => {
  const cfg: TimeConfig = { timezone: 'Asia/Shanghai', format: 'loose', showOffset: true };
  assert.equal(renderTime(T, cfg), '2026-05-24 16:45:00 +0800');
});

test('renderTime: loose with offset in UTC shows +0000', () => {
  const cfg: TimeConfig = { timezone: 'UTC', format: 'loose', showOffset: true };
  assert.equal(renderTime(T, cfg), '2026-05-24 08:45:00 +0000');
});

test('renderTime: loose no-offset, non-UTC', () => {
  const cfg: TimeConfig = { timezone: 'America/Los_Angeles', format: 'loose', showOffset: false };
  // LA in May is DST (PDT, -07:00). 08:45 UTC → 01:45 local.
  assert.equal(renderTime(T, cfg), '2026-05-24 01:45:00');
});

test('renderTime: empty/null input → empty string', () => {
  const cfg: TimeConfig = { timezone: 'UTC', format: 'compact', showOffset: false };
  assert.equal(renderTime(null, cfg), '');
  assert.equal(renderTime(undefined, cfg), '');
  assert.equal(renderTime('', cfg), '');
});

test('renderTime: ISO string input parses', () => {
  const cfg: TimeConfig = { timezone: 'UTC', format: 'compact', showOffset: false };
  assert.equal(renderTime('2026-05-24T08:45:00Z', cfg), '20260524T084500Z');
});

test('renderTime: unix seconds input parses', () => {
  // 1748083500 = 2025-05-24T11:25:00Z (sanity-check the helper accepts numbers
  // when they're large enough to be seconds since epoch)
  const cfg: TimeConfig = { timezone: 'UTC', format: 'compact', showOffset: false };
  // 1577836800 = 2020-01-01T00:00:00Z (in seconds since epoch)
  assert.equal(renderTime(1577836800, cfg), '20200101T000000Z');
});

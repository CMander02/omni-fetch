import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDuration, fmtSize, sanitize, yamlStr, fmtTs, fmtIsoCompact, nowIsoCompact } from '../src/core/format.ts';

test('fmtDuration', () => {
  assert.equal(fmtDuration(0), '0:00');
  assert.equal(fmtDuration(59), '0:59');
  assert.equal(fmtDuration(60), '1:00');
  assert.equal(fmtDuration(3661), '1:01:01');
});

test('fmtSize', () => {
  assert.equal(fmtSize(0), '未知');
  assert.equal(fmtSize(1024), '1.0 KB');
  assert.equal(fmtSize(1048576), '1.0 MB');
  assert.equal(fmtSize(5 * 1048576), '5.0 MB');
});

test('sanitize removes filesystem-unsafe chars', () => {
  assert.equal(sanitize('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
  assert.equal(sanitize(''), 'download');
  assert.equal(sanitize('   '), 'download');
});

test('sanitize truncates to 80 chars', () => {
  assert.equal(sanitize('x'.repeat(200)).length, 80);
});

test('fmtTs: unix sec → YYYYMMDDTHHMMSSZ (UTC)', () => {
  // 1577836800 = 2020-01-01T00:00:00Z
  assert.equal(fmtTs(1577836800), '20200101T000000Z');
  assert.equal(fmtTs(0), '');
  // 1706184000 = 2024-01-25T12:00:00Z
  assert.equal(fmtTs(1706184000), '20240125T120000Z');
});

test('fmtIsoCompact: accepts ISO/Date/ms → compact UTC', () => {
  assert.equal(fmtIsoCompact('2020-01-01T00:00:00Z'), '20200101T000000Z');
  assert.equal(fmtIsoCompact('2026-05-23T07:37:13.349Z'), '20260523T073713Z');
  assert.equal(fmtIsoCompact(new Date('2026-05-24T08:45:00Z')), '20260524T084500Z');
  // Date-only string (arxiv published)
  assert.equal(fmtIsoCompact('2026-05-01'), '20260501T000000Z');
  // milliseconds-since-epoch number (rednote uses ms)
  assert.equal(fmtIsoCompact(1577836800000), '20200101T000000Z');
  assert.equal(fmtIsoCompact(''), '');
  assert.equal(fmtIsoCompact(null), '');
  assert.equal(fmtIsoCompact(undefined), '');
});

test('nowIsoCompact: returns valid compact UTC string', () => {
  const s = nowIsoCompact();
  assert.match(s, /^\d{8}T\d{6}Z$/);
});

test('yamlStr quotes when needed', () => {
  assert.equal(yamlStr(''), '""');
  assert.equal(yamlStr('plain'), 'plain');
  assert.equal(yamlStr('has: colon'), '"has: colon"');
  assert.equal(yamlStr('has "quote"'), '"has \\"quote\\""');
  assert.equal(yamlStr('multi\nline'), '"multi\\nline"');
});

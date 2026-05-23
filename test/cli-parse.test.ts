import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli-parse.ts';

test('parseArgs: bare url', () => {
  const r = parseArgs(['node', 'of', 'https://x.com/a']);
  assert.equal(r.url, 'https://x.com/a');
  assert.equal(r.flags.json, undefined);
  assert.equal(r.flags.markdown, undefined);
});

test('parseArgs: --json', () => {
  const r = parseArgs(['node', 'of', 'https://x.com/a', '--json']);
  assert.equal(r.flags.json, true);
});

test('parseArgs: --markdown', () => {
  const r = parseArgs(['node', 'of', 'https://x.com/a', '--markdown']);
  assert.equal(r.flags.markdown, true);
});

test('parseArgs: --out <file>', () => {
  const r = parseArgs(['node', 'of', 'url', '--out', 'a.md']);
  assert.equal(r.flags.out, 'a.md');
});

test('parseArgs: --no-subs', () => {
  const r = parseArgs(['node', 'of', 'url', '--no-subs']);
  assert.equal(r.flags['no-subs'], true);
});

test('parseArgs: --media-dir <dir>', () => {
  const r = parseArgs(['node', 'of', 'url', '--media-dir', '/tmp/x']);
  assert.equal(r.flags['media-dir'], '/tmp/x');
});

test('parseArgs: --quality 720p', () => {
  const r = parseArgs(['node', 'of', 'url', '--quality', '720p']);
  assert.equal(r.flags.quality, '720p');
});

test('parseArgs: combined flags', () => {
  const r = parseArgs(['node', 'of', 'url', '--json', '--out', 'a.json', '--no-subs']);
  assert.equal(r.url, 'url');
  assert.equal(r.flags.json, true);
  assert.equal(r.flags.out, 'a.json');
  assert.equal(r.flags['no-subs'], true);
});

test('parseArgs: --help and no url', () => {
  const r = parseArgs(['node', 'of']);
  assert.equal(r.url, '');
  const r2 = parseArgs(['node', 'of', '--help']);
  assert.equal(r2.flags.help, true);
});

test('parseArgs: `of help` subcommand → flags.help = true', () => {
  // `help` as a positional must trigger help output just like --help
  const r = parseArgs(['node', 'of', 'help']);
  assert.equal(r.flags.help, true);
  assert.equal(r.url, '');
});

test('parseArgs: `of -h` short flag → flags.help', () => {
  const r = parseArgs(['node', 'of', '-h']);
  assert.equal(r.flags.help, true);
});

test('parseArgs: `of platforms` subcommand', () => {
  const r = parseArgs(['node', 'of', 'platforms']);
  assert.equal(r.flags.platforms, true);
});

test('parseArgs: `of list` alias of platforms', () => {
  const r = parseArgs(['node', 'of', 'list']);
  assert.equal(r.flags.platforms, true);
});

test('parseArgs: `of version` / -v / --version', () => {
  assert.equal(parseArgs(['node', 'of', 'version']).flags.version, true);
  assert.equal(parseArgs(['node', 'of', '-v']).flags.version, true);
  assert.equal(parseArgs(['node', 'of', '--version']).flags.version, true);
});

test('parseArgs: `of detect <url>` subcommand keeps url', () => {
  const r = parseArgs(['node', 'of', 'detect', 'https://x.com/a']);
  assert.equal(r.flags.detect, true);
  assert.equal(r.url, 'https://x.com/a');
});

test('parseArgs: --export with optional path', () => {
  const r1 = parseArgs(['node', 'of', 'https://x.com/a', '--export']);
  assert.equal(r1.flags.export, true);
  const r2 = parseArgs(['node', 'of', 'https://x.com/a', '--export', 'out.md']);
  assert.equal(r2.flags.export, 'out.md');
  // Followed by another flag, --export stays a boolean
  const r3 = parseArgs(['node', 'of', 'https://x.com/a', '--export', '--type', 'json']);
  assert.equal(r3.flags.export, true);
  assert.equal(r3.flags.type, 'json');
});

test('parseArgs: -e short flag for --export', () => {
  const r = parseArgs(['node', 'of', 'https://x.com/a', '-e']);
  assert.equal(r.flags.export, true);
});

test('parseArgs: --type and --with-media', () => {
  const r = parseArgs(['node', 'of', 'url', '--type', 'json', '--with-media', 'y']);
  assert.equal(r.flags.type, 'json');
  assert.equal(r.flags['with-media'], 'y');
});

test('parseArgs: --quiet', () => {
  const r = parseArgs(['node', 'of', 'url', '--quiet']);
  assert.equal(r.flags.quiet, true);
});

test('parseArgs: xhs share text with multiple tokens — extracts URL from positionals', () => {
  // simulates: of 52 【...】 😆 token1 😆 https://www.xiaohongshu.com/...
  const r = parseArgs([
    'node', 'of',
    '52',
    '【一个新技术交流窗口】',
    '😆',
    '8UBCdZrr6h127L4',
    '😆',
    'https://www.xiaohongshu.com/discovery/item/6a10ef6c000000000702a82b?xsec_token=ABC',
  ]);
  assert.match(r.url, /^https:\/\/www\.xiaohongshu\.com\/discovery\/item\//);
});

test('parseArgs: URL embedded inside a single multi-word positional', () => {
  // simulates: of "share text with https://example.com/x mixed in"
  const r = parseArgs([
    'node', 'of',
    '52 标题 https://www.xiaohongshu.com/discovery/item/abc?xsec_token=XYZ 别的字',
  ]);
  assert.match(r.url, /^https:\/\/www\.xiaohongshu\.com\//);
});

test('parseArgs: URL with surrounding newlines (multi-line paste)', () => {
  const r = parseArgs([
    'node', 'of',
    '为什么ChatGPT模型大了就有上下文联系能力？ - 勇气大爆发的回答 - 知乎\nhttps://www.zhihu.com/question/581851946/answer/2947918521',
  ]);
  assert.equal(r.url, 'https://www.zhihu.com/question/581851946/answer/2947918521');
});

test('parseArgs: bare BV id still works', () => {
  const r = parseArgs(['node', 'of', 'BV1GJ411x7h7']);
  assert.equal(r.url, 'BV1GJ411x7h7');
});

test('parseArgs: when no URL found, returns first positional', () => {
  const r = parseArgs(['node', 'of', 'not-a-url', '52', 'also-not']);
  assert.equal(r.url, 'not-a-url');
});

test('parseArgs: xhslink short URL extracted from share text', () => {
  const r = parseArgs([
    'node', 'of',
    '看看这个 https://xhslink.com/AbC123 分享给你',
  ]);
  assert.equal(r.url, 'https://xhslink.com/AbC123');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../src/detect.ts';

test('detect: wechat', () => {
  assert.equal(detectPlatform('https://mp.weixin.qq.com/s/abcdef'), 'wechat');
  assert.equal(detectPlatform('http://mp.weixin.qq.com/s?__biz=xxx'), 'wechat');
});

test('detect: xiaoyuzhou podcast and episode', () => {
  assert.equal(detectPlatform('https://www.xiaoyuzhoufm.com/podcast/abc123'), 'xiaoyuzhou');
  assert.equal(detectPlatform('https://www.xiaoyuzhoufm.com/episode/abc123'), 'xiaoyuzhou');
});

test('detect: bilibili url and bare BV', () => {
  assert.equal(detectPlatform('https://www.bilibili.com/video/BV1GJ411x7h7'), 'bilibili');
  assert.equal(detectPlatform('BV1GJ411x7h7'), 'bilibili');
  assert.equal(detectPlatform('https://b23.tv/abc'), 'fallback', 'short links fall through to yt-dlp');
});

test('detect: xhs full and short', () => {
  assert.equal(detectPlatform('https://www.xiaohongshu.com/explore/abc?xsec_token=x'), 'rednote');
  assert.equal(detectPlatform('https://xhslink.com/AbC123'), 'rednote');
  assert.equal(detectPlatform('https://www.xiaohongshu.com/discovery/item/abc?xsec_token=x'), 'rednote');
});

test('detect: zhihu zhuanlan', () => {
  assert.equal(detectPlatform('https://zhuanlan.zhihu.com/p/123456789'), 'zhihu');
});

test('detect: zhihu answer page', () => {
  assert.equal(detectPlatform('https://www.zhihu.com/question/581851946/answer/2947918521'), 'zhihu');
  assert.equal(detectPlatform('https://zhihu.com/question/123/answer/456'), 'zhihu');
});

test('detect: unknown → ytdlp-generic for http(s) urls', () => {
  assert.equal(detectPlatform('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'fallback');
  assert.equal(detectPlatform('https://youtu.be/dQw4w9WgXcQ'), 'fallback');
  assert.equal(detectPlatform('https://vimeo.com/12345'), 'fallback');
});

test('detect: non-url returns null (not ytdlp-generic)', () => {
  assert.equal(detectPlatform('not a url'), null);
  assert.equal(detectPlatform(''), null);
});

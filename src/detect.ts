import type { Platform } from './core/types.ts';
import { detect as detectWechat } from './platforms/wechat/detect.ts';
import { detect as detectXiaoyuzhou } from './platforms/xiaoyuzhou/detect.ts';
import { detect as detectBilibili } from './platforms/bilibili/detect.ts';
import { detect as detectRednote } from './platforms/rednote/detect.ts';
import { detect as detectZhihu } from './platforms/zhihu/detect.ts';
import { detect as detectX } from './platforms/x/detect.ts';
import { detect as detectArxiv } from './platforms/arxiv/detect.ts';
import { detect as detectApplePodcasts } from './platforms/apple-podcasts/detect.ts';
import { detect as detectHackerNews } from './platforms/hackernews/detect.ts';
import { detect as detectReddit } from './platforms/reddit/detect.ts';
import { detect as detectPixiv } from './platforms/pixiv/detect.ts';

const DETECTORS = [
  detectArxiv,    // run before others — bare ids must beat the URL fallback
  detectWechat,
  detectXiaoyuzhou,
  detectBilibili,
  detectRednote,
  detectZhihu,
  detectX,
  detectApplePodcasts,
  detectHackerNews,
  detectReddit,
  detectPixiv,
];

export function detectPlatform(input: string): Platform | null {
  if (!input) return null;
  const url = input.trim();
  for (const fn of DETECTORS) {
    const p = fn(url);
    if (p) return p;
  }
  if (/^https?:\/\//i.test(url)) return 'fallback';
  return null;
}

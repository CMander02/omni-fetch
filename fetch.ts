#!/usr/bin/env npx tsx
/**
 * omni-fetch — 统一内容抓取工具
 *
 * 支持平台:
 *   微信公众号  mp.weixin.qq.com/s/...
 *   小宇宙播客  xiaoyuzhoufm.com/podcast/... 或 /episode/...
 *   B站视频    bilibili.com/video/BV...
 *   小红书     xiaohongshu.com/explore/... 或 xhslink.com/...
 *   知乎专栏   zhuanlan.zhihu.com/p/...       ← Playwright，需先 auth
 *
 * 用法:
 *   npx tsx fetch.ts <url> [选项]
 *
 * 选项:
 *   --json              输出 JSON（默认 Obsidian Markdown）
 *   --out <file>        保存到文件（默认 stdout）
 *   --media             同时下载媒体文件（图片/视频/音频）
 *   --media-dir <dir>   媒体保存目录（默认 ./media）
 *   --quality <画质>    视频画质: 360p | 480p | 720p | 1080p（默认 360p）
 *   --mode <gui|headless>  知乎 Playwright 模式（默认 gui）
 */

import { writeFileSync, mkdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ═══════════════════════════════════════════════════════════════════════════════
// CLI 解析
// ═══════════════════════════════════════════════════════════════════════════════

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json')   { flags.json = true; continue; }
    if (a === '--media')  { flags.media = true; continue; }
    if (a === '--out' || a === '--media-dir' || a === '--quality' || a === '--mode') {
      flags[a.slice(2)] = args[++i] ?? '';
      continue;
    }
    if (a.startsWith('--')) { flags[a.slice(2)] = true; continue; }
    positionals.push(a);
  }

  return { flags, url: positionals[0] ?? '' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 平台路由
// ═══════════════════════════════════════════════════════════════════════════════

type Platform = 'wechat' | 'xiaoyuzhou' | 'bilibili' | 'xhs' | 'zhihu';

function detectPlatform(url: string): Platform | null {
  if (/mp\.weixin\.qq\.com\/s/.test(url))            return 'wechat';
  if (/xiaoyuzhoufm\.com\/(podcast|episode)/.test(url)) return 'xiaoyuzhou';
  if (/bilibili\.com\/video/.test(url) || /^BV[a-zA-Z0-9]{10}$/.test(url)) return 'bilibili';
  if (/xiaohongshu\.com/.test(url) || /xhslink\.com/.test(url))             return 'xhs';
  if (/zhuanlan\.zhihu\.com\/p\//.test(url))         return 'zhihu';
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 共通工具
// ═══════════════════════════════════════════════════════════════════════════════

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
];

function randomUA(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUA(),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

async function httpGetBuffer(url: string, headers: Record<string, string> = {}): Promise<{ buf: Buffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': randomUA(), ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? '',
  };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function htmlToMarkdown(html: string): string {
  if (!html) return '';
  let md = html;
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<!--[\s\S]*?-->/g, '');
  // code blocks first
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, c) => '```\n' + decodeEntities(stripTags(c)) + '\n```\n');
  for (let i = 1; i <= 6; i++) {
    md = md.replace(new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, 'gi'),
      (_, t) => `\n${'#'.repeat(i)} ${stripTags(t).trim()}\n`);
  }
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, t) => `**${stripTags(t)}**`);
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, t) => `**${stripTags(t)}**`);
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, t) => `*${stripTags(t)}*`);
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, t) => `*${stripTags(t)}*`);
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${stripTags(t)}\``);
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = stripTags(text).trim();
    return t ? `[${t}](${href})` : href;
  });
  md = md.replace(/<img[^>]*?(?:data-src|src)="([^"]*)"[^>]*?(?:alt="([^"]*)")?[^>]*?\/?>/gi,
    (_, src, alt) => `\n![${alt ?? ''}](${src})\n`);
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<\/p>/gi, '\n\n');
  md = md.replace(/<p[^>]*>/gi, '');
  md = md.replace(/<\/div>/gi, '\n');
  md = md.replace(/<div[^>]*>/gi, '');
  md = md.replace(/<\/section>/gi, '\n');
  md = md.replace(/<section[^>]*>/gi, '');
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, t) => stripTags(t).trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n');
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi,
    (_, c) => c.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => `- ${stripTags(item).trim()}\n`));
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, c) => {
    let i = 0;
    return c.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_: string, item: string) => `${++i}. ${stripTags(item).trim()}\n`);
  });
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');
  md = stripTags(md);
  md = decodeEntities(md);
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

function yamlStr(s: string): string {
  if (!s) return '""';
  if (/[:#\[\]{}&*!|>'",\n\\]/.test(s)) return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return s;
}

function fmtTs(ts: number): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmtDuration(s: number): string {
  if (!s) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function fmtSize(bytes: number): string {
  if (!bytes) return '未知';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'download';
}

// ═══════════════════════════════════════════════════════════════════════════════
// 通用 FetchResult 结构
// ═══════════════════════════════════════════════════════════════════════════════

interface MediaAsset {
  url: string;
  type: 'image' | 'video' | 'audio';
  filename: string;      // suggested filename
  quality?: string;      // e.g. "1080P", "h264"
  width?: number;
  height?: number;
  size?: number;
  backupUrls?: string[];
}

interface FetchResult {
  platform: Platform;
  url: string;
  title: string;
  fetched_at: string;
  meta: Record<string, unknown>;
  body_markdown: string;
  media: MediaAsset[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ① 微信公众号
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchWechat(url: string): Promise<FetchResult> {
  const html = await httpGet(url, { Referer: 'https://mp.weixin.qq.com/' });

  const jsVar = (name: string) =>
    html.match(new RegExp(`var ${name}\\s*=\\s*["']([^"']+)["']`))?.[1] ?? '';
  const jsVarDecoded = (name: string) => {
    const raw = html.match(new RegExp(`var ${name}\\s*=\\s*'([^']+)'`))?.[1]
      ?? html.match(new RegExp(`var ${name}\\s*=\\s*htmlDecode\\("([^"]+)"\\)`))?.[1] ?? '';
    return decodeEntities(raw);
  };
  const ogMeta = (prop: string) =>
    html.match(new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`, 'i'))?.[1] ?? '';

  const title = jsVarDecoded('msg_title') || ogMeta('og:title') || '(无标题)';
  const publishTs = parseInt(jsVar('ct'), 10) || 0;
  const coverUrl = jsVar('msg_cdn_url') || ogMeta('og:image') || '';

  const contentHtml =
    html.match(/id="js_content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/section/i)?.[1]?.trim() ??
    html.match(/class="[^"]*rich_media_content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>/i)?.[1]?.trim() ?? '';

  const meta = {
    source: 'wechat',
    title,
    description: jsVarDecoded('msg_desc') || ogMeta('og:description') || '',
    author: html.match(/id="js_author_name"[^>]*>([^<]+)</)?.[1]?.trim() ?? '',
    account_name: html.match(/nick_name:\s*'([^']+)'/)?.[1] ?? '',
    account_id: jsVar('user_name'),
    account_avatar: jsVar('ori_head_img_url'),
    url: jsVar('msg_link') || ogMeta('og:url') || url,
    publish_time: fmtTs(publishTs),
    publish_timestamp: publishTs,
    cover_url: coverUrl,
    source_url: jsVar('msg_source_url') || null,
    is_original: html.includes('copyright_logo') && html.includes('原创'),
  };

  const media: MediaAsset[] = coverUrl ? [{ url: coverUrl, type: 'image', filename: 'cover.jpg' }] : [];

  return { platform: 'wechat', url, title, fetched_at: new Date().toISOString(), meta, body_markdown: htmlToMarkdown(contentHtml), media };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ② 小宇宙
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchXiaoyuzhou(url: string): Promise<FetchResult> {
  const html = await httpGet(url, { Referer: 'https://www.xiaoyuzhoufm.com/' });
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ not found');
  const data = JSON.parse(m[1]);

  const isPodcast = url.includes('/podcast/');
  const raw = isPodcast ? data?.props?.pageProps?.podcast : data?.props?.pageProps?.episode;
  if (!raw) throw new Error(`${isPodcast ? 'Podcast' : 'Episode'} data not found`);

  if (isPodcast) {
    const p = raw;
    const recentEps = (p.episodes ?? []).map((ep: any) => ({
      eid: ep.eid,
      title: ep.title ?? '',
      pubDate: ep.pubDate ?? '',
      duration: ep.duration ?? 0,
      playCount: ep.playCount ?? 0,
      commentCount: ep.commentCount ?? 0,
      episodeUrl: `https://www.xiaoyuzhoufm.com/episode/${ep.eid}`,
      mediaUrl: ep.enclosure?.url ?? ep.media?.source?.url ?? '',
    }));

    const meta = {
      source: 'xiaoyuzhou', type: 'podcast',
      pid: p.pid, title: p.title ?? '', author: p.author ?? '',
      brief: p.brief ?? '', description: p.description ?? '',
      subscriptionCount: p.subscriptionCount ?? 0,
      episodeCount: p.episodeCount ?? 0,
      coverUrl: p.image?.picUrl ?? '',
      latestEpisodePubDate: p.latestEpisodePubDate ?? '',
      url,
      podcasters: (p.podcasters ?? []).map((h: any) => ({
        uid: h.uid, nickname: h.nickname ?? '', bio: h.bio ?? '',
        avatar: h.avatar?.picture?.picUrl ?? '',
        profileUrl: `https://www.xiaoyuzhoufm.com/user/${h.uid}`,
      })),
      recentEpisodes: recentEps,
    };

    const epLines = recentEps.map((ep: any, i: number) =>
      `| ${i + 1} | [${ep.title}](${ep.episodeUrl}) | ${ep.pubDate?.slice(0, 10)} | ${fmtDuration(ep.duration)} | ${ep.playCount} |`
    );
    const body = [
      `## 频道简介\n\n${p.brief ?? ''}\n`,
      p.description ? `## 描述\n\n${p.description}\n` : '',
      `## 最近节目\n\n| # | 标题 | 发布 | 时长 | 播放 |\n|---|---|---|---|---|\n${epLines.join('\n')}\n`,
    ].join('\n');

    const media: MediaAsset[] = p.image?.picUrl
      ? [{ url: p.image.picUrl, type: 'image', filename: 'cover.jpg' }] : [];

    return { platform: 'xiaoyuzhou', url, title: p.title ?? '', fetched_at: new Date().toISOString(), meta, body_markdown: body, media };
  } else {
    const ep = raw;
    const mediaUrl = ep.enclosure?.url ?? ep.media?.source?.url ?? '';
    const meta = {
      source: 'xiaoyuzhou', type: 'episode',
      eid: ep.eid, pid: ep.pid, title: ep.title ?? '',
      pubDate: ep.pubDate ?? '',
      duration: ep.duration ?? 0,
      duration_fmt: fmtDuration(ep.duration ?? 0),
      playCount: ep.playCount ?? 0,
      favoriteCount: ep.favoriteCount ?? 0,
      commentCount: ep.commentCount ?? 0,
      mediaUrl,
      mediaMimeType: ep.media?.mimeType ?? '',
      mediaSize: ep.media?.size ?? 0,
      mediaSize_fmt: fmtSize(ep.media?.size ?? 0),
      coverUrl: ep.image?.picUrl ?? '',
      description: ep.description ?? '',
      hasTranscript: !!(ep.transcript?.mediaId || ep.transcriptMediaId),
      url,
    };

    const body = [
      ep.description ? `## 节目简介\n\n${ep.description}\n` : '',
      ep.shownotes ? `## Shownotes\n\n${ep.shownotes}\n` : '',
      mediaUrl ? `## 媒体文件\n\n[🎧 下载音频](${mediaUrl})\n\n大小: ${fmtSize(ep.media?.size ?? 0)}  时长: ${fmtDuration(ep.duration ?? 0)}\n` : '',
    ].filter(Boolean).join('\n');

    const media: MediaAsset[] = [];
    if (ep.image?.picUrl) media.push({ url: ep.image.picUrl, type: 'image', filename: 'cover.jpg' });
    if (mediaUrl) media.push({
      url: mediaUrl, type: 'audio',
      filename: `${sanitize(ep.title ?? 'episode')}.m4a`,
      size: ep.media?.size ?? 0,
    });

    return { platform: 'xiaoyuzhou', url, title: ep.title ?? '', fetched_at: new Date().toISOString(), meta, body_markdown: body, media };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ③ B站（WBI 签名 + 视频下载）
// ═══════════════════════════════════════════════════════════════════════════════

const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BILI_HEADERS = { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' };

const WBI_MIXIN_TAB = [
  46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,
  27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,
  37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,
  22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52,
];

function wbiMixinKey(orig: string): string {
  return WBI_MIXIN_TAB.map(n => orig[n]).join('').slice(0, 32);
}

function encWbi(params: Record<string, string | number>, imgKey: string, subKey: string): string {
  const key = wbiMixinKey(imgKey + subKey);
  const wts = Math.round(Date.now() / 1000);
  const merged = { ...params, wts };
  const query = Object.keys(merged).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(merged[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${query}&w_rid=${createHash('md5').update(query + key).digest('hex')}`;
}

interface BiliQuality { qn: number; label: string }
const BILI_QUALITIES: BiliQuality[] = [
  { qn: 80, label: '1080P' },
  { qn: 64, label: '720P'  },
  { qn: 32, label: '480P'  },
  { qn: 16, label: '360P'  },
];
const QUALITY_MAP: Record<string, number> = { '1080p': 80, '720p': 64, '480p': 32, '360p': 16 };

// 优先 DASH（配套音视频，ffmpeg 合并），回退 FLV/MP4（单文件）
// 不登录最高 720P，逐档降级直到拿到流
const BILI_QUALITY_OPTIONS: Array<{ qn: number; fnval: number }> = [
  { qn: 80, fnval: 16 }, // 1080P DASH
  { qn: 64, fnval: 16 }, // 720P  DASH
  { qn: 32, fnval: 16 }, // 480P  DASH
  { qn: 16, fnval: 16 }, // 360P  DASH
  { qn: 80, fnval: 0  }, // 1080P FLV (回退)
  { qn: 64, fnval: 0  }, // 720P  FLV (回退)
  { qn: 32, fnval: 0  }, // 480P  FLV (回退)
  { qn: 16, fnval: 0  }, // 360P  FLV (回退)
];

async function biliFetch(path: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.bilibili.com${path}?${qs}`, { headers: BILI_HEADERS });
  if (!res.ok) throw new Error(`Bili API HTTP ${res.status}`);
  const j = await res.json();
  if (j.code !== 0) throw new Error(`Bili API ${j.code}: ${j.message}`);
  return j.data;
}

async function biliWbiKeys(): Promise<{ imgKey: string; subKey: string }> {
  // nav API 未登录时 code=-101 但 data.wbi_img 仍有值，不用 biliFetch（会抛错）
  const res = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: BILI_HEADERS });
  const j = await res.json();
  const wbi = j?.data?.wbi_img;
  if (!wbi?.img_url) throw new Error('无法获取 WBI 密钥');
  const { img_url, sub_url } = wbi;
  return {
    imgKey: img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.')),
    subKey: sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.')),
  };
}

function parseBvid(input: string): string | null {
  if (/^BV[a-zA-Z0-9]{10}$/.test(input)) return input;
  return input.match(/BV([a-zA-Z0-9]{10})/)?.[0] ?? null;
}

async function fetchBilibili(url: string, qualityLabel?: string): Promise<FetchResult> {
  const bvid = parseBvid(url);
  if (!bvid) throw new Error(`无法识别 BV 号: ${url}`);

  const [info, tagRes] = await Promise.all([
    biliFetch('/x/web-interface/view', { bvid }),
    fetch(`https://api.bilibili.com/x/tag/archive/tags?bvid=${bvid}`, { headers: BILI_HEADERS })
      .then(r => r.json()).then(j => (j.code === 0 ? j.data : [])).catch(() => []),
  ]);

  const tags: string[] = (tagRes ?? []).map((t: { tag_name: string }) => t.tag_name);
  const pages = (info.pages ?? []).map((p: any) => ({
    cid: p.cid, page: p.page, part: p.part, duration: p.duration,
  }));

  const meta = {
    source: 'bilibili',
    bvid: info.bvid, aid: info.aid,
    title: info.title, description: info.desc,
    owner: info.owner.name, owner_mid: info.owner.mid, owner_face: info.owner.face,
    category: info.tname, tags,
    cover_url: info.pic,
    duration: info.duration, duration_fmt: fmtDuration(info.duration),
    publish_time: fmtTs(info.pubdate), publish_timestamp: info.pubdate,
    view: info.stat.view, like: info.stat.like, coin: info.stat.coin,
    favorite: info.stat.favorite, share: info.stat.share,
    danmaku: info.stat.danmaku, reply: info.stat.reply,
    pages,
    url: `https://www.bilibili.com/video/${info.bvid}`,
  };

  const body = [
    `**UP主**: ${info.owner.name}  \n**分区**: ${info.tname}  \n**时长**: ${fmtDuration(info.duration)}  \n**发布**: ${fmtTs(info.pubdate)}\n`,
    `**播放**: ${info.stat.view.toLocaleString()}  **点赞**: ${info.stat.like}  **投币**: ${info.stat.coin}  **收藏**: ${info.stat.favorite}\n`,
    info.desc ? `## 简介\n\n${info.desc}\n` : '',
    tags.length ? `## 标签\n\n${tags.map(t => `\`${t}\``).join('  ')}\n` : '',
    pages.length > 1 ? `## 分P\n\n${pages.map((p: any) => `${p.page}. ${p.part || info.title} (${fmtDuration(p.duration)})`).join('\n')}\n` : '',
  ].filter(Boolean).join('\n');

  // 选定画质上限
  const targetQn = qualityLabel ? (QUALITY_MAP[qualityLabel.toLowerCase()] ?? 16) : 16;

  const media: MediaAsset[] = [
    { url: info.pic, type: 'image', filename: 'cover.jpg' },
  ];

  // 尝试获取播放地址（MeowSev 方案：逐档降级，优先 FLV/MP4，备用 DASH）
  try {
    const { imgKey, subKey } = await biliWbiKeys();
    const cid = pages[0]?.cid ?? info.pages?.[0]?.cid;
    if (cid) {
      // 过滤出不超过目标画质的候选
      const candidates = BILI_QUALITY_OPTIONS.filter(o => o.qn <= targetQn);

      let gotStreams = false;
      for (const opt of candidates) {
        const params = { bvid, cid: String(cid), qn: String(opt.qn), fnval: String(opt.fnval), fourk: '1', platform: 'html5' };
        const query = encWbi(params, imgKey, subKey);
        const playRes = await fetch(`https://api.bilibili.com/x/player/wbi/playurl?${query}`, { headers: BILI_HEADERS });
        const playJson = await playRes.json();
        if (playJson.code !== 0) continue;

        const pd = playJson.data;
        const qualityLabel = BILI_QUALITIES.find(q => q.qn === pd.quality)?.label
          ?? pd.accept_description?.[pd.accept_quality?.indexOf(pd.quality)]
          ?? `${opt.qn}P`;

        if (pd.durl?.length > 0) {
          // FLV/MP4 单文件
          const d = pd.durl[0];
          media.push({
            url: d.url, type: 'video',
            filename: `${sanitize(info.title)}_${qualityLabel}.mp4`,
            quality: qualityLabel, size: d.size,
            backupUrls: d.backup_url ?? [],
          });
          console.error(`  画质: ${qualityLabel} (FLV/MP4, durl)`);
          gotStreams = true;
          break;
        }

        if (pd.dash?.video?.length > 0 && pd.dash?.audio?.length > 0) {
          const videoStream = pd.dash.video[0];
          const audioStream = pd.dash.audio[0];
          media.push({
            url: videoStream.baseUrl, type: 'video',
            filename: `${sanitize(info.title)}_${qualityLabel}_video.m4s`,
            quality: qualityLabel,
            width: videoStream.width, height: videoStream.height,
            backupUrls: videoStream.backupUrl ?? [],
          });
          media.push({
            url: audioStream.baseUrl, type: 'audio',
            filename: `${sanitize(info.title)}_audio.m4a`,
            backupUrls: audioStream.backupUrl ?? [],
          });
          console.error(`  画质: ${qualityLabel} (DASH, 需 ffmpeg 合并)`);
          gotStreams = true;
          break;
        }
      }

      if (!gotStreams) console.error('  ⚠ 未能获取到任何可用视频流（未登录限制）');
    }
  } catch (e: any) { console.error(`  ⚠ 播放地址获取失败: ${e.message}`); }

  return { platform: 'bilibili', url, title: info.title, fetched_at: new Date().toISOString(), meta, body_markdown: body, media };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ④ 小红书
// ═══════════════════════════════════════════════════════════════════════════════

function xhsRandomUA(): string {
  const major = 120 + Math.floor(Math.random() * 16);
  const build = Math.floor(Math.random() * 9999);
  const safari = 537 + Math.floor(Math.random() * 68);
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/${safari}.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.0 Safari/${safari}.36`;
}

async function resolveXhsUrl(input: string): Promise<string> {
  if (!/xhslink\.com/.test(input)) return input;
  const m = input.match(/(https?:\/\/xhslink\.com\/[a-zA-Z0-9/]+)/);
  if (!m) throw new Error('无法提取 xhslink 短链');
  const res = await fetch(m[1], {
    redirect: 'follow',
    headers: { 'User-Agent': xhsRandomUA(), Referer: 'https://www.xiaohongshu.com/' },
  });
  return res.url;
}

function extractPostId(url: string): { postId: string; xsecToken: string; canonicalUrl: string } | null {
  // 支持 /explore/, /discovery/item/, /item/, /user/profile/ 路径
  const m = url.match(/\/(?:explore|discovery\/item|item|user\/profile)\/([a-zA-Z0-9]+)/);
  const u = (() => { try { return new URL(url); } catch { return null; } })();
  if (!m || !u) return null;
  const postId = m[1];
  const xsecToken = u.searchParams.get('xsec_token') ?? '';
  if (!xsecToken) return null;
  // 保留原始路径结构（discovery/item 不转换成 explore，避免 -510001）
  const canonicalUrl = `${u.origin}${u.pathname}?xsec_token=${xsecToken}`;
  return { postId, xsecToken, canonicalUrl };
}

// 递归在整个 state 对象里找 noteId 匹配的 note（处理 noteDetailMap key 为 "undefined" 的情况）
function findNoteDict(value: unknown, postId: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNoteDict(item, postId);
      if (found) return found;
    }
    return null;
  }
  const obj = value as Record<string, unknown>;
  const id = obj.noteId ?? obj.id ?? obj.note_id;
  if (id === postId && ('type' in obj || 'video' in obj || 'imageList' in obj)) return obj;
  for (const child of Object.values(obj)) {
    const found = findNoteDict(child, postId);
    if (found) return found;
  }
  return null;
}

function xhsTransformOriginal(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('xhscdn.com')) {
      const segs = u.pathname.split('/').filter(Boolean).slice(2);
      const last = segs.pop() ?? '';
      return `https://ci.xiaohongshu.com/${[...segs, last.split('!')[0]].join('/')}`;
    }
    if (u.hostname === 'ci.xiaohongshu.com') return `${u.origin}${u.pathname}`;
  } catch { /* ignore */ }
  return urlStr;
}

async function fetchXhs(url: string): Promise<FetchResult> {
  const resolvedUrl = await resolveXhsUrl(url);
  const info = extractPostId(resolvedUrl);
  if (!info) throw new Error('无法解析小红书链接（需要包含 xsec_token）');

  const pageHtml = await httpGet(info.canonicalUrl, {
    Referer: 'https://www.xiaohongshu.com/',
    Cookie: 'webId=anonymous',
  });

  const stateM = pageHtml.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?})(?:<\/script>|;)/);
  if (!stateM) throw new Error('__INITIAL_STATE__ not found');
  const state = JSON.parse(stateM[1].replace(/:undefined/g, ':null'));

  // 先尝试直接 key 查找，再回退到递归搜索（处理 key 为 "undefined" 的情况）
  const ndm = state?.note?.noteDetailMap ?? {};
  const wrapper = ndm[info.postId];
  let note: Record<string, unknown> | null =
    (wrapper?.note ?? wrapper?.noteInfo ?? (wrapper && typeof wrapper === 'object' && 'type' in wrapper ? wrapper : null)) ?? null;
  if (!note) note = findNoteDict(state, info.postId);
  if (!note) throw new Error('Note data not found');

  const isVideo = note.type === 'video' || (note.videoList?.length ?? 0) > 0;
  const title = note.title ?? note.desc ?? '';

  const media: MediaAsset[] = [];

  if (isVideo) {
    const stream = note.video?.media?.stream;
    let videoAsset: MediaAsset | null = null;
    for (const codec of ['h265', 'h264', 'av1', 'h266']) {
      const streams = stream?.[codec];
      if (!Array.isArray(streams) || streams.length === 0) continue;
      const s = streams[0];
      videoAsset = {
        url: s.masterUrl, type: 'video',
        filename: `${sanitize(title)}.mp4`,
        quality: s.qualityType ?? codec,
        width: s.width, height: s.height,
        size: s.size ?? 0,
        backupUrls: s.backupUrls ?? [],
      };
      break;
    }
    if (videoAsset) media.push(videoAsset);
  } else {
    (note.imageList ?? []).forEach((img: any, i: number) => {
      const origUrl = xhsTransformOriginal(img.urlDefault || img.url);
      media.push({ url: origUrl, type: 'image', filename: `image_${i + 1}.jpg` });
    });
  }

  // 封面
  const coverUrl = note.imageList?.[0]?.urlDefault ?? note.video?.image?.firstFrameUrl ?? '';

  const meta = {
    source: 'xhs',
    postId: info.postId,
    title, isVideo,
    coverUrl,
    desc: note.desc ?? '',
    tags: (note.tagList ?? []).map((t: any) => t.name ?? t.id),
    likeCount: note.interactInfo?.likedCount ?? 0,
    collectCount: note.interactInfo?.collectCount ?? 0,
    commentCount: note.interactInfo?.commentCount ?? 0,
    url: resolvedUrl,
    mediaCount: media.filter(m => m.type !== 'image' || !m.filename.includes('cover')).length,
  };

  const body = [
    note.desc ? `${note.desc}\n` : '',
    (note.tagList ?? []).length ? `\n**标签**: ${(note.tagList as any[]).map((t: any) => `#${t.name ?? t.id}`).join(' ')}\n` : '',
    isVideo ? `\n**类型**: 视频\n` : `\n**图片数**: ${(note.imageList ?? []).length}\n`,
  ].filter(Boolean).join('');

  return { platform: 'xhs', url, title, fetched_at: new Date().toISOString(), meta, body_markdown: body, media };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ⑤ 知乎（Playwright，继承 zhihu_profile）
// ═══════════════════════════════════════════════════════════════════════════════

async function fetchZhihu(url: string, mode: string): Promise<FetchResult> {
  // 动态 import playwright，未安装时给出清晰错误
  let chromium: any;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('知乎抓取需要 Playwright。请先运行: npm install playwright');
  }

  const PROFILE_DIR = resolve(__dirname, '..', 'zhihu-fetch', 'zhihu_profile');
  const articleId = url.match(/\/p\/(\d+)/)?.[1] ?? '';
  if (!articleId) throw new Error(`无法解析知乎文章 ID: ${url}`);

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  const STEALTH = `
    Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});
    window.chrome = {runtime: {}};
  `;

  const ctxOpts = {
    userAgent: UA, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    viewport: { width: 1280, height: 900 },
  };
  const commonArgs = ['--disable-blink-features=AutomationControlled', '--window-position=9999,9999'];

  const captured = { html: '', commentsApi: [] as any[] };
  let ctx: any;

  if (existsSync(PROFILE_DIR)) {
    console.error(`使用已保存的 profile: ${PROFILE_DIR}`);
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: mode === 'headless',
      channel: mode === 'gui' ? 'chrome' : undefined,
      args: [...commonArgs, ...(mode === 'headless' ? ['--disable-dev-shm-usage', '--no-sandbox'] : [])],
      ...ctxOpts,
    });
  } else {
    console.error('⚠ 未找到知乎 profile，请先运行: npx tsx ../zhihu-fetch/auth.ts login');
    const browser = await chromium.launch({ headless: false, channel: 'chrome', args: commonArgs });
    ctx = await browser.newContext(ctxOpts);
  }

  await ctx.addInitScript(STEALTH);
  ctx.on('response', async (response: any) => {
    if (response.url().includes(`comment_v5/articles/${articleId}/root_comment`)) {
      try { captured.commentsApi.push(await response.json()); } catch {}
    }
  });
  await ctx.route('**/*.{png,jpg,jpeg,gif,webp,mp4,woff,woff2,ttf}', (route: any) => route.abort());

  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForSelector('.RichText.ztext, .Post-RichText', { timeout: 15000 }).catch(() => {});
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1000);
  captured.html = await page.content();
  await ctx.close();

  // 解析 initialState
  const scriptRe = /<script[^>]*>(\{"initialState":[\s\S]*?)<\/script>/g;
  let art: any = null;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRe.exec(captured.html)) !== null) {
    try {
      const st = JSON.parse(sm[1]) as any;
      const candidate = st.initialState?.entities?.articles?.[articleId];
      if (candidate) { art = candidate; break; }
    } catch { continue; }
  }

  const fmtTsSv = (ts: number | null) => ts ? new Date(ts * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).replace('T', ' ') : '';

  const title = art ? String(art.title ?? '') : '';
  const author = art?.author as any;
  const topics: string[] = (art?.topics as { name: string }[] ?? []).map(t => t.name);
  const bodyMd = art?.content ? htmlToMarkdown(String(art.content)) : '';

  // 评论
  const comments: any[] = [];
  for (const pg of captured.commentsApi as { data?: any[] }[]) {
    for (const c of (pg.data ?? [])) {
      comments.push({
        id: c.id, author_name: c.author?.name ?? '', author_id: c.author?.id ?? '',
        content: c.content ?? '', created_time: fmtTsSv(c.created_time),
        like_count: c.like_count ?? 0, is_author: !!c.is_author,
        child_comments: (c.child_comments ?? []).map((ch: any) => ({
          author_name: ch.author?.name ?? '', content: ch.content ?? '',
          created_time: fmtTsSv(ch.created_time), like_count: ch.like_count ?? 0,
        })),
      });
    }
  }

  const e = art ? {
    voteup: art.voteupCount ?? 0, liked: art.likedCount ?? 0,
    favorites: art.favlistsCount ?? 0, comments: art.commentCount ?? 0,
    shares: (art.reaction as any)?.statistics?.shareCount ?? 0,
  } : { voteup: 0, liked: 0, favorites: 0, comments: 0, shares: 0 };

  const meta = {
    source: 'zhihu', article_id: articleId, title,
    author_name: author?.name ?? '', author_uuid: author?.id ?? '',
    author_uid: author?.uid ?? '', author_url_token: author?.urlToken ?? '',
    author_profile: author?.urlToken ? `https://www.zhihu.com/people/${author.urlToken}` : '',
    created_at: fmtTsSv(art?.created), updated_at: fmtTsSv(art?.updated),
    ip_info: art?.ipInfo ?? '', topics, ...e,
    comments_loaded: comments.length, url,
  };

  // 评论 Markdown
  const commentMd = comments.length > 0 ? [
    `\n---\n\n## 评论（共 ${e.comments} 条，已加载 ${comments.length} 条）\n`,
    ...comments.map(c => {
      const tag = c.is_author ? ' #作者' : '';
      const lines = [
        `> [!quote] **${c.author_name}**${tag} · ${c.created_time} · 👍${c.like_count}`,
        `> \`${c.author_id}\``, `>`, `> ${c.content}`,
      ];
      for (const ch of c.child_comments) {
        lines.push(`>`, `> > **${ch.author_name}** · ${ch.created_time} · 👍${ch.like_count}`, `> > ${ch.content}`);
      }
      return lines.join('\n');
    }),
  ].join('\n\n') : '';

  const body = bodyMd + commentMd;

  return { platform: 'zhihu', url, title, fetched_at: new Date().toISOString(), meta, body_markdown: body, media: [] };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Markdown 渲染（统一格式）
// ═══════════════════════════════════════════════════════════════════════════════

function toMarkdown(r: FetchResult): string {
  const m = r.meta;
  const lines = ['---'];

  // 公共字段
  lines.push(`title: ${yamlStr(r.title)}`);
  lines.push(`url: ${r.url}`);
  lines.push(`source: ${String(m.source ?? r.platform)}`);
  lines.push(`fetched_at: "${r.fetched_at}"`);

  // 平台专属字段
  const skip = new Set(['source', 'title', 'url', 'description', 'body_markdown', 'content_html',
    'recentEpisodes', 'podcasters', 'pages', 'tags', 'topics']);

  for (const [k, v] of Object.entries(m)) {
    if (skip.has(k) || v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlStr(String(item))}`);
    } else if (typeof v === 'object') {
      continue; // 对象型跳过（recentEpisodes 等已在 body 里）
    } else {
      lines.push(`${k}: ${yamlStr(String(v))}`);
    }
  }

  // tags / topics
  const tagList = (m.tags ?? m.topics) as string[] | undefined;
  if (tagList?.length) {
    lines.push('tags:');
    for (const t of tagList) lines.push(`  - ${yamlStr(t)}`);
  }

  lines.push('---');
  const frontmatter = lines.join('\n');

  // 标题行
  const desc = String(m.description ?? m.desc ?? m.brief ?? '');
  const header = [
    `\n# ${r.title}\n`,
    desc ? `> ${desc}\n` : '',
  ].join('\n');

  return `${frontmatter}${header}\n${r.body_markdown}\n`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 媒体下载
// ═══════════════════════════════════════════════════════════════════════════════

async function downloadMedia(assets: MediaAsset[], dir: string, platform: Platform): Promise<void> {
  mkdirSync(dir, { recursive: true });

  for (const asset of assets) {
    const outPath = join(dir, asset.filename);
    console.error(`  ↓ ${asset.filename} (${asset.type}${asset.quality ? ' ' + asset.quality : ''})`);

    try {
      // 流式下载，带进度
      const tryUrls = [asset.url, ...(asset.backupUrls ?? [])];
      let downloaded = false;

      for (const tryUrl of tryUrls) {
        try {
          const headers: Record<string, string> = { 'User-Agent': randomUA() };
          if (platform === 'bilibili') {
            Object.assign(headers, BILI_HEADERS);
          } else if (platform === 'xhs') {
            headers.Referer = 'https://www.xiaohongshu.com/';
          }

          const res = await fetch(tryUrl, { headers });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          // 检测真实扩展名（图片）
          let finalPath = outPath;
          if (asset.type === 'image') {
            const ct = res.headers.get('content-type') ?? '';
            const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
            finalPath = outPath.replace(/\.[^.]+$/, ext);
          }

          const buf = Buffer.from(await res.arrayBuffer());
          writeFileSync(finalPath, buf);
          console.error(`    ✓ ${(buf.length / 1024).toFixed(0)} KB → ${finalPath}`);
          downloaded = true;
          break;
        } catch (e: any) {
          console.error(`    ✗ 尝试失败: ${e.message}`);
        }
      }

      if (!downloaded) console.error(`    ✗ 所有地址均失败，跳过`);
    } catch (e: any) {
      console.error(`    ✗ ${asset.filename}: ${e.message}`);
    }
  }

  // B站 DASH：如果有视频+音频流，尝试用 ffmpeg 合并
  if (platform === 'bilibili') {
    const videoFile = assets.find(a => a.type === 'video' && a.filename.endsWith('.m4s'));
    const audioFile = assets.find(a => a.type === 'audio' && a.filename.endsWith('.m4a'));
    if (videoFile && audioFile) {
      const videoPath = join(dir, videoFile.filename);
      const audioPath = join(dir, audioFile.filename);
      const baseName = videoFile.filename.replace('_video.m4s', '');
      const outputPath = join(dir, `${baseName}.mp4`);
      console.error(`  合并音视频 → ${outputPath}`);
      const merged = await ffmpegMerge(videoPath, audioPath, outputPath);
      if (merged) {
        try { unlinkSync(videoPath); } catch {}
        try { unlinkSync(audioPath); } catch {}
        console.error(`  ✓ 合并完成`);
      } else {
        console.error(`  ⚠ ffmpeg 未安装，保留分离的音视频文件`);
      }
    }
  }
}

function ffmpegMerge(video: string, audio: string, output: string): Promise<boolean> {
  return new Promise(resolve => {
    const proc = spawn('ffmpeg', ['-y', '-i', video, '-i', audio, '-c:v', 'copy', '-c:a', 'aac', output], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.on('close', code => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════════════════════

function usage() {
  console.error(`
omni-fetch — 统一内容抓取工具

用法: npx tsx fetch.ts <url> [选项]

支持平台:
  微信公众号  mp.weixin.qq.com/s/...
  小宇宙      xiaoyuzhoufm.com/podcast/... 或 /episode/...
  B站         bilibili.com/video/BV... 或直接输入 BVxxxxxx
  小红书      xiaohongshu.com/explore/...?xsec_token=... 或 xhslink.com/...
  知乎专栏    zhuanlan.zhihu.com/p/...  (需要 Playwright + 已登录 session)

选项:
  --json              输出 JSON（默认 Obsidian Markdown）
  --out <file>        保存到文件（默认 stdout）
  --media             下载媒体（图片/视频/音频）
  --media-dir <dir>   媒体保存目录（默认 ./media/<标题>）
  --quality <画质>    视频画质: 360p | 480p | 720p | 1080p（默认 360p）
  --mode <模式>       知乎: gui | headless（默认 gui）

示例:
  npx tsx fetch.ts "https://mp.weixin.qq.com/s/Xvoh9hGnqe7rJ_ns5tRwBQ"
  npx tsx fetch.ts "https://www.bilibili.com/video/BV1GJ411x7h7" --json
  npx tsx fetch.ts "https://www.bilibili.com/video/BV1GJ411x7h7" --media --quality 480p
  npx tsx fetch.ts "https://www.xiaoyuzhoufm.com/episode/xxx" --media --out ep.md
  npx tsx fetch.ts "https://www.xiaohongshu.com/explore/xxx?xsec_token=xxx" --media
  npx tsx fetch.ts "https://zhuanlan.zhihu.com/p/xxx" --out article.md --json article.json
`);
}

async function main() {
  const { flags, url } = parseArgs(process.argv);

  if (!url || flags.help) { usage(); process.exit(url ? 0 : 1); }

  const platform = detectPlatform(url);
  if (!platform) {
    console.error(`✗ 无法识别平台: ${url}`);
    console.error('  支持: 微信 / 小宇宙 / B站 / 小红书 / 知乎');
    process.exit(1);
  }

  const jsonMode = !!flags.json;
  const outFile   = flags.out ? resolve(String(flags.out)) : null;
  const doMedia   = !!flags.media;
  const mediaDir  = flags['media-dir'] ? resolve(String(flags['media-dir'])) : null;
  const quality   = String(flags.quality ?? '360p');
  const mode      = String(flags.mode ?? 'gui');

  console.error(`平台: ${platform}  URL: ${url}`);

  let result: FetchResult;
  try {
    switch (platform) {
      case 'wechat':      result = await fetchWechat(url); break;
      case 'xiaoyuzhou':  result = await fetchXiaoyuzhou(url); break;
      case 'bilibili':    result = await fetchBilibili(url, quality); break;
      case 'xhs':         result = await fetchXhs(url); break;
      case 'zhihu':       result = await fetchZhihu(url, mode); break;
    }
  } catch (e: any) {
    console.error(`✗ 抓取失败: ${e.message}`);
    process.exit(1);
  }

  console.error(`✓ ${result.title}`);

  // 输出文字内容
  const output = jsonMode ? JSON.stringify({ ...result.meta, body_markdown: result.body_markdown, media: result.media }, null, 2) : toMarkdown(result);

  if (outFile) {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, output, 'utf-8');
    console.error(`✓ 已保存: ${outFile}`);
  } else {
    process.stdout.write(output);
  }

  // 下载媒体
  if (doMedia) {
    const mediaToDl = platform === 'wechat'
      ? result.media.filter(a => a.type !== 'image')  // 微信只有封面图，无独立媒体
      : result.media;

    if (mediaToDl.length === 0) {
      console.error('⚠ 该平台/内容无可下载媒体');
    } else {
      const dir = mediaDir ?? join('.', 'media', sanitize(result.title));
      console.error(`\n下载媒体 (${mediaToDl.length} 个) → ${dir}`);
      await downloadMedia(mediaToDl, dir, platform);
    }
  }
}

main().catch(e => { console.error(`✗ ${e.message}`); process.exit(1); });

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fmtUserTime, nowUserTime, fmtDuration, sanitize } from '../../core/format.ts';
import type { FetchResult, MediaAsset, FetchOptions } from '../../core/types.ts';
import { fetchSubtitles, detectYtdlp } from '../../core/ytdlp.ts';

const BILI_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
export const BILI_HEADERS = { 'User-Agent': BILI_UA, Referer: 'https://www.bilibili.com/' };

function normalizeBiliCookie(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  if (text.includes('=')) return text;
  return `SESSDATA=${text}`;
}

function readBiliCookieFile(): string {
  const paths = [
    process.env.OMNIFETCH_BILIBILI_COOKIE_FILE,
    join(homedir(), '.config', 'omnifetch', 'bilibili-cookie'),
  ].filter(Boolean) as string[];
  for (const path of paths) {
    try {
      const text = readFileSync(path, 'utf8');
      const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
      if (!lines.length) continue;
      const envLike = lines.find((line) => /^(OMNIFETCH_BILIBILI_COOKIE|BILIBILI_COOKIE|BILI_COOKIE|BILIBILI_SESSDATA|SESSDATA)=/.test(line));
      if (envLike) return normalizeBiliCookie(envLike.slice(envLike.indexOf('=') + 1));
      return normalizeBiliCookie(lines.join('; '));
    } catch {
      // Ignore missing/unreadable optional credential files.
    }
  }
  return '';
}

function biliCookie(): string {
  const raw = process.env.OMNIFETCH_BILIBILI_COOKIE || process.env.BILIBILI_COOKIE || process.env.BILI_COOKIE || '';
  if (raw.trim()) return normalizeBiliCookie(raw);
  const sess = process.env.BILIBILI_SESSDATA || process.env.SESSDATA || '';
  if (sess.trim()) return normalizeBiliCookie(sess);
  return readBiliCookieFile();
}

function headersWithCookie(): Record<string, string> {
  const cookie = biliCookie();
  return cookie ? { ...BILI_HEADERS, Cookie: cookie } : BILI_HEADERS;
}

function fmtBiliTimestamp(sec: number | string | undefined): string {
  const n = Number(sec || 0);
  if (!Number.isFinite(n) || n < 0) return '00:00';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}


const WBI_MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

function wbiMixinKey(orig: string): string {
  return WBI_MIXIN_TAB.map((n) => orig[n]).join('').slice(0, 32);
}

function encWbi(params: Record<string, string | number>, imgKey: string, subKey: string): string {
  const key = wbiMixinKey(imgKey + subKey);
  const wts = Math.round(Date.now() / 1000);
  const merged: Record<string, string | number> = { ...params, wts };
  const query = Object.keys(merged).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(merged[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${query}&w_rid=${createHash('md5').update(query + key).digest('hex')}`;
}

interface BiliQuality { qn: number; label: string }
const BILI_QUALITIES: BiliQuality[] = [
  { qn: 80, label: '1080P' },
  { qn: 64, label: '720P' },
  { qn: 32, label: '480P' },
  { qn: 16, label: '360P' },
];
const QUALITY_MAP: Record<string, number> = { '1080p': 80, '720p': 64, '480p': 32, '360p': 16 };

const BILI_QUALITY_OPTIONS: Array<{ qn: number; fnval: number }> = [
  { qn: 80, fnval: 16 }, { qn: 64, fnval: 16 }, { qn: 32, fnval: 16 }, { qn: 16, fnval: 16 },
  { qn: 80, fnval: 0 }, { qn: 64, fnval: 0 }, { qn: 32, fnval: 0 }, { qn: 16, fnval: 0 },
];

async function biliFetch(path: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.bilibili.com${path}?${qs}`, { headers: BILI_HEADERS });
  if (!res.ok) throw new Error(`Bili API HTTP ${res.status}`);
  const j: any = await res.json();
  if (j.code !== 0) throw new Error(`Bili API ${j.code}: ${j.message}`);
  return j.data;
}

async function biliWbiKeys(): Promise<{ imgKey: string; subKey: string }> {
  const res = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: BILI_HEADERS });
  const j: any = await res.json();
  const wbi = j?.data?.wbi_img;
  if (!wbi?.img_url) throw new Error('无法获取 WBI 密钥');
  const { img_url, sub_url } = wbi;
  return {
    imgKey: img_url.slice(img_url.lastIndexOf('/') + 1, img_url.lastIndexOf('.')),
    subKey: sub_url.slice(sub_url.lastIndexOf('/') + 1, sub_url.lastIndexOf('.')),
  };
}


async function fetchBiliAiSummary(params: { bvid: string; cid: number | string; upMid?: number | string; imgKey: string; subKey: string }): Promise<{ data?: any; error?: string; needLogin?: boolean }> {
  const cookie = biliCookie();
  if (!cookie) return { error: '需要登录 Cookie（设置 OMNIFETCH_BILIBILI_COOKIE / BILIBILI_COOKIE / BILI_COOKIE / SESSDATA）', needLogin: true };
  const signed = encWbi({
    bvid: params.bvid,
    cid: String(params.cid),
    ...(params.upMid ? { up_mid: String(params.upMid) } : {}),
  }, params.imgKey, params.subKey);
  const res = await fetch(`https://api.bilibili.com/x/web-interface/view/conclusion/get?${signed}`, { headers: headersWithCookie() });
  const j: any = await res.json();
  if (j.code !== 0) return { error: `Bili AI 总结 API ${j.code}: ${j.message}`, needLogin: j.code === -101 };
  if (!j.data) return { error: 'Bili AI 总结 API 返回空 data' };
  if (j.data.code !== 0) {
    const reason = j.data.code === 1
      ? (j.data.stid === '0' ? '该视频尚未生成 AI 总结，已进入/可进入总结队列' : '该视频无可用 AI 总结（可能未识别到语音）')
      : '该视频不支持 AI 总结或请求异常';
    return { data: j.data, error: reason };
  }
  return { data: j.data };
}

export interface BiliOutlinePoint {
  timestamp: number;
  time: string;
  content: string;
  segment_timestamp?: number;
  segment_time?: string;
  segment_title?: string;
}

export interface BiliOutlineSegment {
  timestamp: number;
  time: string;
  title: string;
  details: BiliOutlinePoint[];
}

export interface BiliNormalizedOutline {
  summary: string;
  time_kv: Record<string, string>;
  detail_kv: Record<string, string>;
  segments: BiliOutlineSegment[];
  details: BiliOutlinePoint[];
}

export function normalizeBiliAiOutline(ai: any): BiliNormalizedOutline {
  const model = ai?.model_result ?? ai ?? {};
  const rawSegments = Array.isArray(model.outline) ? model.outline : [];
  const result: BiliNormalizedOutline = {
    summary: String(model.summary ?? '').trim(),
    time_kv: {},
    detail_kv: {},
    segments: [],
    details: [],
  };
  for (const item of rawSegments) {
    const timestamp = Number(item?.timestamp ?? 0);
    const time = fmtBiliTimestamp(timestamp);
    const title = String(item?.title ?? '').trim();
    if (title) result.time_kv[time] = title;
    const segment: BiliOutlineSegment = { timestamp, time, title, details: [] };
    const parts = Array.isArray(item?.part_outline) ? item.part_outline : [];
    for (const part of parts) {
      const pointTimestamp = Number(part?.timestamp ?? 0);
      const pointTime = fmtBiliTimestamp(pointTimestamp);
      const content = String(part?.content ?? '').trim();
      if (!content) continue;
      const point: BiliOutlinePoint = {
        timestamp: pointTimestamp,
        time: pointTime,
        content,
        segment_timestamp: timestamp,
        segment_time: time,
        segment_title: title,
      };
      result.detail_kv[pointTime] = content;
      segment.details.push(point);
      result.details.push(point);
    }
    if (title || segment.details.length) result.segments.push(segment);
  }
  return result;
}

function aiSummaryToMarkdown(ai: any): string {
  const model = ai?.model_result ?? {};
  const outline = normalizeBiliAiOutline(model);
  const lines: string[] = [];
  if (outline.summary) {
    lines.push('## B站 AI 总结', '', outline.summary, '');
  }
  if (outline.segments.length) {
    lines.push('### AI 时间轴', '');
    for (const segment of outline.segments) {
      if (segment.title) lines.push(`- **${segment.time}** ${segment.title}`);
      for (const part of segment.details) {
        lines.push(`  - **${part.time}** ${part.content}`);
      }
    }
    lines.push('');
  }
  const subtitles = Array.isArray(model.subtitle) ? model.subtitle : [];
  const count = subtitles.reduce((sum: number, seg: any) => sum + (Array.isArray(seg?.part_subtitle) ? seg.part_subtitle.length : 0), 0);
  if (count) lines.push(`> B站 AI 字幕分段：${count} 条（JSON 输出中保留完整 subtitle 字段）。`, '');
  return lines.join('\n');
}

function parseBvid(input: string): string | null {
  if (/^BV[a-zA-Z0-9]{10}$/.test(input)) return input;
  return input.match(/BV[a-zA-Z0-9]{10}/)?.[0] ?? null;
}

export async function fetchBilibili(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const bvid = parseBvid(url);
  if (!bvid) throw new Error(`无法识别 BV 号: ${url}`);

  const [info, tagRes] = await Promise.all([
    biliFetch('/x/web-interface/view', { bvid }),
    fetch(`https://api.bilibili.com/x/tag/archive/tags?bvid=${bvid}`, { headers: BILI_HEADERS })
      .then((r) => r.json()).then((j: any) => (j.code === 0 ? j.data : [])).catch(() => []),
  ]);

  const tags: string[] = (tagRes ?? []).map((t: { tag_name: string }) => t.tag_name);
  const pages = (info.pages ?? []).map((p: any) => ({
    cid: p.cid, page: p.page, part: p.part, duration: p.duration,
  }));

  const meta: Record<string, unknown> = {
    source: 'bilibili',
    bvid: info.bvid, aid: info.aid,
    title: info.title, description: info.desc,
    owner: info.owner.name, owner_mid: info.owner.mid, owner_face: info.owner.face,
    category: info.tname, tags,
    cover_url: info.pic,
    duration: info.duration, duration_fmt: fmtDuration(info.duration),
    publish_time: info.pubdate ? fmtUserTime(new Date(info.pubdate * 1000)) : '', publish_timestamp: info.pubdate,
    view: info.stat.view, like: info.stat.like, coin: info.stat.coin,
    favorite: info.stat.favorite, share: info.stat.share,
    danmaku: info.stat.danmaku, reply: info.stat.reply,
    pages,
    url: `https://www.bilibili.com/video/${info.bvid}`,
  };

  let body = [
    `**UP主**: ${info.owner.name}  \n**分区**: ${info.tname}  \n**时长**: ${fmtDuration(info.duration)}  \n**发布**: ${info.pubdate ? fmtUserTime(new Date(info.pubdate * 1000)) : ''}\n`,
    `**播放**: ${info.stat.view.toLocaleString()}  **点赞**: ${info.stat.like}  **投币**: ${info.stat.coin}  **收藏**: ${info.stat.favorite}\n`,
    info.desc ? `## 简介\n\n${info.desc}\n` : '',
    tags.length ? `## 标签\n\n${tags.map((t) => `\`${t}\``).join('  ')}\n` : '',
    pages.length > 1 ? `## 分P\n\n${pages.map((p: any) => `${p.page}. ${p.part || info.title} (${fmtDuration(p.duration)})`).join('\n')}\n` : '',
  ].filter(Boolean).join('\n');

  const targetQn = opts.quality ? (QUALITY_MAP[opts.quality.toLowerCase()] ?? 16) : 16;

  const media: MediaAsset[] = [
    { url: info.pic, type: 'image', filename: 'cover.jpg' },
  ];

  try {
    const { imgKey, subKey } = await biliWbiKeys();
    const cid = pages[0]?.cid ?? info.pages?.[0]?.cid;
    if (cid) {
      const candidates = BILI_QUALITY_OPTIONS.filter((o) => o.qn <= targetQn);
      let gotStreams = false;
      for (const opt of candidates) {
        const params = { bvid, cid: String(cid), qn: String(opt.qn), fnval: String(opt.fnval), fourk: '1', platform: 'html5' };
        const query = encWbi(params, imgKey, subKey);
        const playRes = await fetch(`https://api.bilibili.com/x/player/wbi/playurl?${query}`, { headers: BILI_HEADERS });
        const playJson: any = await playRes.json();
        if (playJson.code !== 0) continue;
        const pd = playJson.data;
        const qualityLabel = BILI_QUALITIES.find((q) => q.qn === pd.quality)?.label
          ?? pd.accept_description?.[pd.accept_quality?.indexOf(pd.quality)]
          ?? `${opt.qn}P`;
        if (pd.durl?.length > 0) {
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
          const v = pd.dash.video[0];
          const a = pd.dash.audio[0];
          media.push({
            url: v.baseUrl, type: 'video',
            filename: `${sanitize(info.title)}_${qualityLabel}_video.m4s`,
            quality: qualityLabel, width: v.width, height: v.height,
            backupUrls: v.backupUrl ?? [],
          });
          media.push({
            url: a.baseUrl, type: 'audio',
            filename: `${sanitize(info.title)}_audio.m4a`,
            backupUrls: a.backupUrl ?? [],
          });
          console.error(`  画质: ${qualityLabel} (DASH, 需 ffmpeg 合并)`);
          gotStreams = true;
          break;
        }
      }
      if (!gotStreams) console.error('  ⚠ 未能获取到任何可用视频流（未登录限制）');
    }
  } catch (e: any) {
    console.error(`  ⚠ 播放地址获取失败: ${e.message}`);
  }

  try {
    const { imgKey, subKey } = await biliWbiKeys();
    const cid = pages[0]?.cid ?? info.pages?.[0]?.cid;
    if (cid) {
      const ai = await fetchBiliAiSummary({ bvid: info.bvid, cid, upMid: info.owner?.mid, imgKey, subKey });
      if (ai.data) {
        meta.ai_summary = ai.data.model_result ?? null;
        meta.outline = normalizeBiliAiOutline(ai.data.model_result ?? null);
        meta.ai_summary_status = { code: ai.data.code, stid: ai.data.stid, status: ai.data.status, like_num: ai.data.like_num, dislike_num: ai.data.dislike_num };
        const aiMd = aiSummaryToMarkdown(ai.data);
        if (aiMd) body += `
${aiMd}`;
        if (ai.error) {
          meta.ai_summary_note = ai.error;
          console.error(`  ⚠ B站 AI 总结: ${ai.error}`);
        } else {
          console.error('  ✓ B站 AI 总结已抓取');
        }
      } else if (ai.error) {
        meta.ai_summary_error = ai.error;
        meta.ai_summary_need_login = !!ai.needLogin;
        console.error(`  ⚠ B站 AI 总结跳过: ${ai.error}`);
      }
    }
  } catch (e: any) {
    meta.ai_summary_error = e.message;
    console.error(`  ⚠ B站 AI 总结抓取失败: ${e.message}`);
  }

  // 字幕（yt-dlp）
  if (!opts.noSubs) {
    const ydl = detectYtdlp();
    if (ydl.available) {
      try {
        const sub = await fetchSubtitles(`https://www.bilibili.com/video/${bvid}`, opts.subLangs);
        if (sub && sub.text) {
          meta.subtitles_lang = sub.lang;
          meta.subtitles_auto = sub.auto;
          body += `\n## 字幕 (${sub.lang}${sub.auto ? ', 自动生成' : ''})\n\n${sub.text}\n`;
          console.error(`  ✓ 字幕已抓取: ${sub.lang}${sub.auto ? ' (auto)' : ''}`);
        }
      } catch (e: any) {
        console.error(`  ⚠ 字幕抓取失败: ${e.message}`);
      }
    } else {
      console.error('  ⚠ 跳过字幕：yt-dlp 未安装（uv tool install yt-dlp 启用，或 --no-subs 静默）');
    }
  }

  return {
    platform: 'bilibili', url, title: info.title,
    fetched_at: nowUserTime(),
    meta, body_markdown: body, media,
  };
}

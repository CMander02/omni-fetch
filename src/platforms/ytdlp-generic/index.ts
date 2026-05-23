import { fmtDuration, sanitize, nowUserTime } from '../../core/format.ts';
import type { FetchResult, MediaAsset, FetchOptions } from '../../core/types.ts';
import { detectYtdlp, fetchVideoInfo, fetchSubtitles, ytdlpInstallHint } from '../../core/ytdlp.ts';

export async function fetchYtdlpGeneric(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const ydl = detectYtdlp();
  if (!ydl.available) {
    throw new Error(`未识别为已知平台，需要 yt-dlp 作为通用 fallback。\n${ytdlpInstallHint()}`);
  }

  const info = await fetchVideoInfo(url);
  if (!info) throw new Error(`yt-dlp 无法解析此 URL: ${url}`);

  const title = info.title ?? '(无标题)';

  const meta: Record<string, unknown> = {
    source: info.extractor_key ?? info.extractor ?? 'ytdlp-generic',
    extractor: info.extractor,
    id: info.id,
    title,
    description: info.description ?? '',
    uploader: info.uploader ?? info.channel ?? '',
    duration: info.duration ?? 0,
    duration_fmt: info.duration ? fmtDuration(info.duration) : '',
    upload_date: info.upload_date ?? '',
    view_count: info.view_count ?? 0,
    like_count: info.like_count ?? 0,
    thumbnail: info.thumbnail ?? '',
    webpage_url: info.webpage_url ?? url,
    tags: info.tags ?? [],
    url,
  };

  let body = [
    info.uploader ? `**作者**: ${info.uploader}  ` : '',
    info.duration ? `**时长**: ${fmtDuration(info.duration)}  ` : '',
    info.upload_date ? `**发布**: ${info.upload_date}  ` : '',
    info.view_count ? `**播放**: ${info.view_count.toLocaleString()}` : '',
  ].filter(Boolean).join('\n') + '\n';

  if (info.description) body += `\n## 简介\n\n${info.description}\n`;
  if (info.tags?.length) body += `\n## 标签\n\n${info.tags.map((t) => `\`${t}\``).join('  ')}\n`;

  const media: MediaAsset[] = [];
  if (info.thumbnail) {
    media.push({ url: info.thumbnail, type: 'image', filename: 'cover.jpg' });
  }

  if (!opts.noSubs) {
    try {
      const sub = await fetchSubtitles(url, opts.subLangs);
      if (sub && sub.text) {
        meta.subtitles_lang = sub.lang;
        meta.subtitles_auto = sub.auto;
        body += `\n## 字幕 (${sub.lang}${sub.auto ? ', 自动生成' : ''})\n\n${sub.text}\n`;
        console.error(`  ✓ 字幕已抓取: ${sub.lang}`);
      }
    } catch (e: any) {
      console.error(`  ⚠ 字幕抓取失败: ${e.message}`);
    }
  }

  return {
    platform: 'ytdlp-generic', url, title,
    fetched_at: nowUserTime(),
    meta, body_markdown: body, media,
  };
}

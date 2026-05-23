import { httpGet } from '../../core/http.ts';
import { htmlToMarkdown, decodeEntities } from '../../core/html.ts';
import { fmtUserTime, nowUserTime } from '../../core/format.ts';
import type { FetchResult, MediaAsset } from '../../core/types.ts';

export async function fetchWechat(url: string): Promise<FetchResult> {
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
    publish_time: publishTs ? fmtUserTime(new Date(publishTs * 1000)) : '',
    publish_timestamp: publishTs,
    cover_url: coverUrl,
    source_url: jsVar('msg_source_url') || null,
    is_original: html.includes('copyright_logo') && html.includes('原创'),
  };

  const media: MediaAsset[] = coverUrl
    ? [{ url: coverUrl, type: 'image', filename: 'cover.jpg' }]
    : [];

  return {
    platform: 'wechat', url, title,
    fetched_at: nowUserTime(),
    meta, body_markdown: htmlToMarkdown(contentHtml), media,
  };
}

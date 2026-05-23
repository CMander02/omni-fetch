/**
 * Generic fallback for unknown URLs.
 *
 * Strategy:
 *   1. Fetch HTML and run defuddle (Readability-style article extractor).
 *      If we get a non-trivial title + body, that's our answer.
 *   2. Otherwise hand the URL to yt-dlp (covers YouTube / Vimeo / Twitter video
 *      / 1000+ video sites; also returns metadata for some non-video pages).
 *   3. If both fail, throw with both error messages joined.
 *
 * Tunable threshold: a "non-trivial" article must have >= 200 chars of body
 * markdown. Tiny matches (cookie banners, "click to verify" pages) are not
 * treated as success.
 */
import { httpGet } from '../../core/http.ts';
import { fmtUserTime, nowUserTime } from '../../core/format.ts';
import type { FetchResult, FetchOptions, MediaAsset } from '../../core/types.ts';
import { fetchYtdlpGeneric } from '../ytdlp-generic/index.ts';

const MIN_ARTICLE_CHARS = 200;

export interface DefuddleArticle {
  title: string;
  description: string;
  author: string;
  published: string;
  image: string;
  domain: string;
  contentMarkdown: string;
  wordCount: number;
}

/**
 * Try defuddle alone. Returns null if the page yields no meaningful article.
 * Exported separately so it can be unit-tested with fixture HTML.
 */
export async function tryDefuddle(html: string, url: string): Promise<DefuddleArticle | null> {
  // Lazy imports — defuddle pulls in linkedom; users without it should still
  // be able to run pure-CLI commands like `of help`.
  let parseHTML: any;
  let Defuddle: any;
  try {
    ({ parseHTML } = await import('linkedom'));
    ({ Defuddle } = await import('defuddle/node'));
  } catch (e: any) {
    throw new Error(`defuddle 依赖未安装: ${e.message}`);
  }

  const { document } = parseHTML(html);
  const result = await Defuddle(document, url, { markdown: true, separateMarkdown: true });
  const md = (result.contentMarkdown ?? result.content ?? '').trim();
  if (!md || md.length < MIN_ARTICLE_CHARS) return null;

  return {
    title: result.title ?? '',
    description: result.description ?? '',
    author: result.author ?? '',
    published: result.published ?? '',
    image: result.image ?? '',
    domain: result.domain ?? '',
    contentMarkdown: md,
    wordCount: result.wordCount ?? 0,
  };
}

function articleToResult(url: string, art: DefuddleArticle): FetchResult {
  const media: MediaAsset[] = art.image
    ? [{ url: art.image, type: 'image', filename: 'cover.jpg' }]
    : [];

  const meta: Record<string, unknown> = {
    source: 'defuddle',
    domain: art.domain,
    title: art.title,
    author: art.author,
    publish_time: art.published ? fmtUserTime(art.published) : '',
    description: art.description,
    word_count: art.wordCount,
    cover_url: art.image,
    url,
  };

  return {
    platform: 'fallback',
    url,
    title: art.title || '(无标题)',
    fetched_at: nowUserTime(),
    meta,
    body_markdown: art.contentMarkdown,
    media,
  };
}

export async function fetchFallback(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const errors: string[] = [];

  // 1) Try defuddle on fetched HTML.
  try {
    const html = await httpGet(url);
    const article = await tryDefuddle(html, url);
    if (article) {
      console.error(`  ✓ defuddle: ${article.wordCount} words from ${article.domain}`);
      return articleToResult(url, article);
    }
    errors.push('defuddle: 抽取到的正文太短或为空');
  } catch (e: any) {
    errors.push(`defuddle: ${e.message}`);
  }

  // 2) Fall through to yt-dlp.
  try {
    console.error('  · defuddle 无果，尝试 yt-dlp ...');
    const r = await fetchYtdlpGeneric(url, opts);
    return r;
  } catch (e: any) {
    errors.push(`yt-dlp: ${e.message}`);
  }

  throw new Error(`无法抓取 ${url}\n${errors.map(e => '  - ' + e).join('\n')}`);
}

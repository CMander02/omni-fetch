/**
 * Generic fallback for unknown URLs.
 *
 * Strategy in auto mode:
 *   1. Fetch HTML and run defuddle.
 *   2. Try Jina Reader API.
 *   3. Try Playwright-rendered HTML + defuddle.
 *   4. Try direct HTML brute-force markdown.
 *   5. Fall through to yt-dlp.
 *
 * Users can force a channel with --article-mode defuddle|jina|playwright|html|yt-dlp.
 */
import { httpGet } from '../../core/http.ts';
import { fmtUserTime, nowUserTime } from '../../core/format.ts';
import { htmlToMarkdown } from '../../core/html.ts';
import { openPage } from '../../core/browser.ts';
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
  source?: string;
}

/**
 * Jina Reader URL format. Exported for unit tests.
 */
export function readerUrl(url: string): string {
  // Jina Reader accepts the target URL as the path after https://r.jina.ai/http://.
  // Example: https://example.com/a -> https://r.jina.ai/http://https://example.com/a
  return `https://r.jina.ai/http://${url}`;
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
    source: 'defuddle',
  };
}

function titleFromMarkdown(md: string, fallback: string): string {
  const m = md.match(/^Title:\s*(.+)$/m) || md.match(/^#\s+(.+)$/m);
  return (m?.[1] ?? fallback).trim() || '(无标题)';
}

export async function tryJinaReader(url: string): Promise<DefuddleArticle | null> {
  const md = (await httpGet(readerUrl(url), { Accept: 'text/plain, text/markdown, */*' })).trim();
  if (!md || md.length < MIN_ARTICLE_CHARS) return null;
  const u = new URL(url);
  return {
    title: titleFromMarkdown(md, u.hostname),
    description: '',
    author: '',
    published: '',
    image: '',
    domain: u.hostname,
    contentMarkdown: md,
    wordCount: md.split(/\s+/).filter(Boolean).length,
    source: 'jina-reader',
  };
}

export async function tryPlaywrightDefuddle(url: string, mode: 'gui' | 'headless' = 'headless'): Promise<DefuddleArticle | null> {
  const { page, closeContext } = await openPage(url, mode);
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    const html = await page.content();
    const article = await tryDefuddle(html, url);
    if (article) article.source = `playwright-${mode}+defuddle`;
    return article;
  } finally {
    await closeContext();
  }
}

function stripNoise(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '');
}

export function tryHtmlBruteforce(html: string, url: string): DefuddleArticle | null {
  const cleaned = stripNoise(html);
  const md = htmlToMarkdown(cleaned).replace(/\n{3,}/g, '\n\n').trim();
  if (!md || md.length < MIN_ARTICLE_CHARS) return null;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? new URL(url).hostname)
    .replace(/\s+/g, ' ')
    .trim();
  return {
    title,
    description: '',
    author: '',
    published: '',
    image: '',
    domain: new URL(url).hostname,
    contentMarkdown: md,
    wordCount: md.split(/\s+/).filter(Boolean).length,
    source: 'html-bruteforce',
  };
}

function articleToResult(url: string, art: DefuddleArticle): FetchResult {
  const media: MediaAsset[] = art.image
    ? [{ url: art.image, type: 'image', filename: 'cover.jpg' }]
    : [];

  const meta: Record<string, unknown> = {
    source: art.source ?? 'defuddle',
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
  const mode = opts.articleMode ?? 'auto';

  async function useDefuddle(): Promise<FetchResult | null> {
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
    return null;
  }

  async function useJina(): Promise<FetchResult | null> {
    try {
      const article = await tryJinaReader(url);
      if (article) {
        console.error(`  ✓ jina-reader: ${article.wordCount} words from ${article.domain}`);
        return articleToResult(url, article);
      }
      errors.push('jina-reader: 返回正文太短或为空');
    } catch (e: any) {
      errors.push(`jina-reader: ${e.message}`);
    }
    return null;
  }

  async function usePlaywright(): Promise<FetchResult | null> {
    try {
      const article = await tryPlaywrightDefuddle(url, opts.mode ?? 'headless');
      if (article) {
        console.error(`  ✓ playwright: ${article.wordCount} words from ${article.domain}`);
        return articleToResult(url, article);
      }
      errors.push('playwright: 抽取到的正文太短或为空');
    } catch (e: any) {
      errors.push(`playwright: ${e.message}`);
    }
    return null;
  }

  async function useHtml(): Promise<FetchResult | null> {
    try {
      const html = await httpGet(url);
      const article = tryHtmlBruteforce(html, url);
      if (article) {
        console.error(`  ✓ html-bruteforce: ${article.wordCount} words from ${article.domain}`);
        return articleToResult(url, article);
      }
      errors.push('html-bruteforce: 正文太短或为空');
    } catch (e: any) {
      errors.push(`html-bruteforce: ${e.message}`);
    }
    return null;
  }

  const ordered = mode === 'auto'
    ? [useDefuddle, useJina, usePlaywright, useHtml]
    : mode === 'defuddle' ? [useDefuddle]
      : mode === 'jina' ? [useJina]
        : mode === 'playwright' ? [usePlaywright]
          : mode === 'html' ? [useHtml]
            : [];

  for (const fn of ordered) {
    const r = await fn();
    if (r) return r;
  }

  if (mode === 'auto' || mode === 'yt-dlp') {
    try {
      console.error('  · 文章渠道无果，尝试 yt-dlp ...');
      return await fetchYtdlpGeneric(url, opts);
    } catch (e: any) {
      errors.push(`yt-dlp: ${e.message}`);
    }
  }

  throw new Error(`无法抓取 ${url}\n${errors.map(e => '  - ' + e).join('\n')}`);
}

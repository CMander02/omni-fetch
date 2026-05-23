/**
 * Pixiv via the browser-side AJAX API.
 *
 * All AJAX endpoints (`https://www.pixiv.net/ajax/...`) require the user's
 * cookies + Referer to access non-public works (R-18, follower-only, etc).
 * Public works *can* be fetched without auth but the same code path covers
 * both — we just drive the user's existing Chrome over CDP, exactly like
 * the X and Zhihu modules. This means:
 *   - No separate session/profile to manage
 *   - R-18 / follower-only artworks just work if the user is logged in
 *   - `i.pximg.net` image URLs in the response keep their hotlink protection;
 *     downloads must set `Referer: https://www.pixiv.net/`
 *
 * Three endpoint families:
 *   - /ajax/illust/<id>         single artwork metadata
 *   - /ajax/illust/<id>/pages   multi-page list (original URLs per page)
 *   - /ajax/user/<id>           user info
 *   - /ajax/user/<id>/profile/all  full illustrations/manga id index
 *   - /ajax/novel/<id>          novel
 *
 * Responses follow the convention `{ error: bool, message: string, body: ... }`.
 */
import { fmtUserTime, nowUserTime } from '../../core/format.ts';
import { sanitize } from '../../core/format.ts';
import { openPage } from '../../core/browser.ts';
import type { FetchResult, MediaAsset } from '../../core/types.ts';
import { parsePixivUrl, type PixivTarget } from './detect.ts';

interface AjaxResponse<T> {
  error: boolean;
  message: string;
  body: T;
}

interface IllustBody {
  illustId: string;
  illustTitle: string;
  description: string;
  illustType: number;          // 0=illust, 1=manga, 2=ugoira
  createDate: string;
  uploadDate: string;
  userId: string;
  userName: string;
  userAccount: string;
  pageCount: number;
  width: number;
  height: number;
  xRestrict: number;           // 0=safe, 1=R-18, 2=R-18G
  bookmarkCount: number;
  likeCount: number;
  viewCount: number;
  tags: { tags: Array<{ tag: string; translation?: { en?: string } }> };
  urls: {
    mini: string;
    thumb: string;
    small: string;
    regular: string;
    original: string;
  };
}

interface IllustPage {
  urls: { thumb_mini: string; small: string; regular: string; original: string };
  width: number;
  height: number;
}

interface UserBody {
  userId: string;
  name: string;
  image: string;          // small avatar
  imageBig: string;       // 170x170 avatar
  comment: string;        // bio
  webpage?: string;
  followedBack?: boolean;
}

interface NovelBody {
  id: string;
  title: string;
  description: string;
  content: string;
  userId: string;
  userName: string;
  createDate: string;
  uploadDate: string;
  textCount: number;
  bookmarkCount: number;
  likeCount: number;
  viewCount: number;
  coverUrl?: string;
  tags: { tags: Array<{ tag: string; translation?: { en?: string } }> };
}

/**
 * Run a fetch() against pixiv.net from inside the user's browser context.
 * Cookies + Referer come along automatically.
 */
async function ajaxInBrowser<T>(page: any, path: string): Promise<T> {
  const result = await page.evaluate(async (p: string) => {
    const res = await fetch(p, { credentials: 'include', headers: { Accept: 'application/json' } });
    return { status: res.status, text: await res.text() };
  }, path);
  if (result.status >= 400) throw new Error(`Pixiv ajax ${path} → HTTP ${result.status}`);
  const parsed = JSON.parse(result.text) as AjaxResponse<T>;
  if (parsed.error) throw new Error(`Pixiv ajax ${path} → ${parsed.message}`);
  return parsed.body;
}

function tagsToList(tagsObj?: { tags: Array<{ tag: string }> }): string[] {
  return (tagsObj?.tags ?? []).map(t => t.tag);
}

export async function fetchPixiv(url: string): Promise<FetchResult> {
  const target = parsePixivUrl(url);
  if (!target) throw new Error(`无法解析 Pixiv URL: ${url}`);

  // Land on the canonical web page so cookies + Referer are correct, then
  // call AJAX from within that origin.
  const { page, closeContext } = await openPage(url);
  try {
    if (target.kind === 'artwork') return await buildArtworkResult(page, target.id, url);
    if (target.kind === 'user')    return await buildUserResult(page, target.id, url);
    return await buildNovelResult(page, target.id, url);
  } finally {
    await closeContext();
  }
}

async function buildArtworkResult(page: any, id: string, url: string): Promise<FetchResult> {
  const illust = await ajaxInBrowser<IllustBody>(page, `/ajax/illust/${id}`);

  // For multi-page works we need the per-page original URLs.
  let pages: IllustPage[] = [];
  if (illust.pageCount > 1) {
    pages = await ajaxInBrowser<IllustPage[]>(page, `/ajax/illust/${id}/pages`);
  }

  const tags = tagsToList(illust.tags);
  const isUgoira = illust.illustType === 2;
  const isManga = illust.illustType === 1;
  const xRestrictLabel = ['safe', 'R-18', 'R-18G'][illust.xRestrict] ?? 'unknown';

  const meta: Record<string, unknown> = {
    source: 'pixiv',
    kind: 'artwork',
    illust_id: illust.illustId,
    title: illust.illustTitle,
    author: illust.userName,
    author_id: illust.userId,
    author_profile: `https://www.pixiv.net/users/${illust.userId}`,
    publish_time: fmtUserTime(illust.uploadDate || illust.createDate),
    description: stripHtml(illust.description),
    illust_type: isUgoira ? 'ugoira' : (isManga ? 'manga' : 'illust'),
    rating: xRestrictLabel,
    page_count: illust.pageCount,
    width: illust.width,
    height: illust.height,
    view_count: illust.viewCount,
    like_count: illust.likeCount,
    bookmark_count: illust.bookmarkCount,
    tags,
    url,
  };

  const lines: string[] = [
    `**作者**: [${illust.userName}](https://www.pixiv.net/users/${illust.userId})`,
    `**类型**: ${meta.illust_type}${isUgoira ? ' (动图)' : ''}  ·  **分级**: ${xRestrictLabel}`,
    `**尺寸**: ${illust.width}×${illust.height}  ·  **页数**: ${illust.pageCount}`,
    `**观看**: ${illust.viewCount}  ·  **点赞**: ${illust.likeCount}  ·  **收藏**: ${illust.bookmarkCount}`,
    tags.length ? `**标签**: ${tags.map(t => `#${t}`).join(' ')}` : '',
  ].filter(Boolean);
  if (illust.description) lines.push('', stripHtml(illust.description));

  const media: MediaAsset[] = [];
  if (illust.pageCount === 1) {
    media.push({
      url: illust.urls.original,
      type: 'image',
      filename: `${illust.illustId}.${extOf(illust.urls.original)}`,
      width: illust.width, height: illust.height,
    });
  } else {
    pages.forEach((p, i) => {
      media.push({
        url: p.urls.original,
        type: 'image',
        filename: `${illust.illustId}_p${i}.${extOf(p.urls.original)}`,
        width: p.width, height: p.height,
      });
    });
  }
  if (isUgoira) {
    // For ugoira the actual animation is a zip of frames; the API endpoint
    // /ajax/illust/<id>/ugoira_meta has the zip URL. Best-effort fetch:
    try {
      const ug = await ajaxInBrowser<{ originalSrc: string; src: string; frames: Array<{ file: string; delay: number }> }>(
        page, `/ajax/illust/${id}/ugoira_meta`,
      );
      media.push({
        url: ug.originalSrc,
        type: 'video',
        filename: `${illust.illustId}_ugoira.zip`,
      });
      meta.ugoira_frames = ug.frames.length;
    } catch { /* not all ugoiras expose meta */ }
  }

  return {
    platform: 'pixiv', url,
    title: illust.illustTitle || `Pixiv ${id}`,
    fetched_at: nowUserTime(),
    meta, body_markdown: lines.join('  \n'), media,
  };
}

async function buildUserResult(page: any, id: string, url: string): Promise<FetchResult> {
  const user = await ajaxInBrowser<UserBody>(page, `/ajax/user/${id}?full=1`);
  // profile/all returns { illusts: {id: null,...}, manga: {...}, novels: {...} }
  const all = await ajaxInBrowser<{ illusts: Record<string, unknown>; manga: Record<string, unknown>; novels: Record<string, unknown> }>(
    page, `/ajax/user/${id}/profile/all`,
  );

  const illustIds = Object.keys(all.illusts ?? {});
  const mangaIds = Object.keys(all.manga ?? {});
  const novelIds = Object.keys(all.novels ?? {});

  const meta: Record<string, unknown> = {
    source: 'pixiv',
    kind: 'user',
    user_id: user.userId,
    author: user.name,
    author_id: user.userId,
    author_profile: `https://www.pixiv.net/users/${user.userId}`,
    author_avatar: user.imageBig || user.image,
    description: stripHtml(user.comment),
    homepage: user.webpage ?? '',
    illust_count: illustIds.length,
    manga_count: mangaIds.length,
    novel_count: novelIds.length,
    url,
  };

  const lines: string[] = [
    `**作品**: ${illustIds.length} 插画  ·  ${mangaIds.length} 漫画  ·  ${novelIds.length} 小说`,
    user.webpage ? `**主页**: [${user.webpage}](${user.webpage})` : '',
    user.comment ? `\n${stripHtml(user.comment)}\n` : '',
  ].filter(Boolean);

  // List the 20 most recent illust ids (descending id ≈ chronological newest).
  const recent = illustIds.sort((a, b) => Number(b) - Number(a)).slice(0, 20);
  if (recent.length) {
    lines.push('', `## 最近作品（${recent.length} / ${illustIds.length}）`, '');
    for (const iid of recent) {
      lines.push(`- [${iid}](https://www.pixiv.net/artworks/${iid})`);
    }
  }

  const media: MediaAsset[] = user.imageBig
    ? [{ url: user.imageBig, type: 'image', filename: 'avatar.jpg' }]
    : [];

  return {
    platform: 'pixiv', url,
    title: `${user.name} (Pixiv #${user.userId})`,
    fetched_at: nowUserTime(),
    meta, body_markdown: lines.join('  \n'), media,
  };
}

async function buildNovelResult(page: any, id: string, url: string): Promise<FetchResult> {
  const novel = await ajaxInBrowser<NovelBody>(page, `/ajax/novel/${id}`);
  const tags = tagsToList(novel.tags);

  const meta: Record<string, unknown> = {
    source: 'pixiv',
    kind: 'novel',
    novel_id: novel.id,
    title: novel.title,
    author: novel.userName,
    author_id: novel.userId,
    author_profile: `https://www.pixiv.net/users/${novel.userId}`,
    publish_time: fmtUserTime(novel.uploadDate || novel.createDate),
    description: stripHtml(novel.description),
    text_count: novel.textCount,
    view_count: novel.viewCount,
    like_count: novel.likeCount,
    bookmark_count: novel.bookmarkCount,
    cover_url: novel.coverUrl ?? '',
    tags,
    url,
  };

  const lines: string[] = [
    `**作者**: [${novel.userName}](https://www.pixiv.net/users/${novel.userId})`,
    `**字数**: ${novel.textCount}  ·  **观看**: ${novel.viewCount}  ·  **点赞**: ${novel.likeCount}  ·  **收藏**: ${novel.bookmarkCount}`,
    tags.length ? `**标签**: ${tags.map(t => `#${t}`).join(' ')}` : '',
    '',
    novel.content,
  ].filter(Boolean);

  const media: MediaAsset[] = novel.coverUrl
    ? [{ url: novel.coverUrl, type: 'image', filename: 'cover.jpg' }]
    : [];

  return {
    platform: 'pixiv', url,
    title: novel.title || `Pixiv novel ${id}`,
    fetched_at: nowUserTime(),
    meta, body_markdown: lines.join('  \n'), media,
  };
}

function stripHtml(s: string): string {
  if (!s) return '';
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extOf(u: string): string {
  return u.split('?')[0].split('.').pop()?.toLowerCase() ?? 'jpg';
}

// Re-export so cli.ts / sanitize is reachable
export { sanitize };

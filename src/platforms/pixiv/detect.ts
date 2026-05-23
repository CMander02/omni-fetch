import type { Platform } from '../../core/types.ts';

export type PixivTarget =
  | { kind: 'artwork'; id: string }
  | { kind: 'user'; id: string }
  | { kind: 'novel'; id: string };

export function parsePixivUrl(input: string): PixivTarget | null {
  if (!input) return null;
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  if (!/^(?:www\.)?pixiv\.net$/i.test(u.hostname)) return null;

  // Strip optional /<lang>/ prefix (e.g. /en/, /ja/, /zh/)
  let path = u.pathname.replace(/^\/[a-z]{2}\//, '/');

  // /artworks/<id>
  let m = path.match(/^\/artworks\/(\d+)$/);
  if (m) return { kind: 'artwork', id: m[1] };

  // /users/<id>[/artworks|/illustrations|/manga|/bookmarks]
  m = path.match(/^\/users\/(\d+)(?:\/.*)?$/);
  if (m) return { kind: 'user', id: m[1] };

  // /novel/show.php?id=<id>
  if (path === '/novel/show.php') {
    const id = u.searchParams.get('id');
    if (id) return { kind: 'novel', id };
  }

  // Legacy: /member_illust.php?mode=medium&illust_id=<id>
  if (path === '/member_illust.php') {
    const id = u.searchParams.get('illust_id');
    if (id) return { kind: 'artwork', id };
  }

  return null;
}

export function detect(url: string): Platform | null {
  return parsePixivUrl(url) ? 'pixiv' : null;
}

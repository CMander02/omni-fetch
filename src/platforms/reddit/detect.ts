import type { Platform } from '../../core/types.ts';

export type RedditTarget =
  | { kind: 'post'; subreddit: string; postId: string }
  | { kind: 'post-short'; postId: string }
  | { kind: 'subreddit'; subreddit: string }
  | { kind: 'user'; userId: string };

export function parseRedditUrl(input: string): RedditTarget | null {
  if (!input) return null;
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  const host = u.hostname.toLowerCase();

  if (host === 'redd.it' || host === 'www.redd.it') {
    const id = u.pathname.replace(/^\/|\/$/g, '');
    return id ? { kind: 'post-short', postId: id } : null;
  }

  if (!/^(?:www\.|old\.|new\.)?reddit\.com$/.test(host)) return null;

  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  // /user/<name>  or  /u/<name>
  if ((parts[0] === 'user' || parts[0] === 'u') && parts[1]) {
    return { kind: 'user', userId: parts[1] };
  }

  // /r/<sub>/comments/<id>[/slug...]
  if (parts[0] === 'r' && parts[1] && parts[2] === 'comments' && parts[3]) {
    return { kind: 'post', subreddit: parts[1], postId: parts[3] };
  }

  // /r/<sub>[/...] — subreddit listing
  if (parts[0] === 'r' && parts[1]) {
    return { kind: 'subreddit', subreddit: parts[1] };
  }

  return null;
}

export function detect(url: string): Platform | null {
  return parseRedditUrl(url) ? 'reddit' : null;
}

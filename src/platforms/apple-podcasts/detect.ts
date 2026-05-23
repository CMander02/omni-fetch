import type { Platform } from '../../core/types.ts';

export type ApplePodcastsTarget =
  | { kind: 'episode'; collectionId: string; episodeId: string; country: string }
  | { kind: 'show'; collectionId: string; country: string };

export function parseApplePodcastsUrl(input: string): ApplePodcastsTarget | null {
  if (!input) return null;
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  if (!/^podcasts\.apple\.com$/i.test(u.hostname)) return null;

  // /<country>/podcast/<slug>/id<digits>      → show
  // /<country>/podcast/<slug>/id<digits>?i=<digits>  → episode
  // /podcast/.../id<digits>  (no country)  → defaults to us
  const m = u.pathname.match(/(?:\/([a-z]{2}))?\/podcast\/[^/]+\/id(\d+)/i);
  if (!m) return null;
  const country = (m[1] ?? 'us').toLowerCase();
  const collectionId = m[2];
  const episodeId = u.searchParams.get('i') ?? '';
  return episodeId
    ? { kind: 'episode', collectionId, episodeId, country }
    : { kind: 'show', collectionId, country };
}

export function detect(url: string): Platform | null {
  return parseApplePodcastsUrl(url) ? 'apple-podcasts' : null;
}

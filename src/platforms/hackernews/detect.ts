import type { Platform } from '../../core/types.ts';

export type HnTarget =
  | { kind: 'item'; id: string }
  | { kind: 'user'; id: string }
  | { kind: 'front' };

export function parseHnUrl(input: string): HnTarget | null {
  if (!input) return null;
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  if (!/^news\.ycombinator\.com$/i.test(u.hostname)) return null;

  if (u.pathname === '/item') {
    const id = u.searchParams.get('id') ?? '';
    return id ? { kind: 'item', id } : null;
  }
  if (u.pathname === '/user') {
    const id = u.searchParams.get('id') ?? '';
    return id ? { kind: 'user', id } : null;
  }
  if (u.pathname === '/' || u.pathname === '') return { kind: 'front' };
  return null;
}

export function detect(url: string): Platform | null {
  return parseHnUrl(url) ? 'hackernews' : null;
}

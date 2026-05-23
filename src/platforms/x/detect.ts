import type { Platform } from '../../core/types.ts';

export function detect(url: string): Platform | null {
  return /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\//i.test(url) ? 'x' : null;
}

import type { Platform } from '../../core/types.ts';

export function detect(url: string): Platform | null {
  return /xiaoyuzhoufm\.com\/(podcast|episode)/.test(url) ? 'xiaoyuzhou' : null;
}

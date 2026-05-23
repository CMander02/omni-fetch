import type { Platform } from '../../core/types.ts';

export function detect(url: string): Platform | null {
  if (/bilibili\.com\/video/.test(url)) return 'bilibili';
  if (/^BV[a-zA-Z0-9]{10}$/.test(url)) return 'bilibili';
  return null;
}

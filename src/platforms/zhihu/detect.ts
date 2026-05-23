import type { Platform } from '../../core/types.ts';

export function detect(url: string): Platform | null {
  if (/zhuanlan\.zhihu\.com\/p\//.test(url)) return 'zhihu';
  if (/(?:www\.)?zhihu\.com\/question\/\d+\/answer\/\d+/.test(url)) return 'zhihu';
  return null;
}

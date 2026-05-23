import type { Platform } from '../../core/types.ts';

export function detect(url: string): Platform | null {
  if (/xiaohongshu\.com/.test(url)) return 'rednote';
  if (/xhslink\.com/.test(url)) return 'rednote';
  return null;
}

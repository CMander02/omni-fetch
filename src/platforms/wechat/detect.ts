import type { Platform } from '../../core/types.ts';

export function detect(url: string): Platform | null {
  return /mp\.weixin\.qq\.com\/s/.test(url) ? 'wechat' : null;
}

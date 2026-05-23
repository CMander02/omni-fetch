export type Platform =
  | 'wechat'
  | 'xiaoyuzhou'
  | 'bilibili'
  | 'rednote'
  | 'zhihu'
  | 'x'
  | 'arxiv'
  | 'apple-podcasts'
  | 'hackernews'
  | 'reddit'
  | 'pixiv'
  | 'fallback'         // HTML article extractor (defuddle) + yt-dlp chain
  | 'ytdlp-generic';   // legacy alias retained for tests

export interface MediaAsset {
  url: string;
  type: 'image' | 'video' | 'audio' | 'document';
  filename: string;
  quality?: string;
  width?: number;
  height?: number;
  size?: number;
  backupUrls?: string[];
}

export interface FetchResult {
  platform: Platform;
  url: string;
  title: string;
  fetched_at: string;
  meta: Record<string, unknown>;
  body_markdown: string;
  media: MediaAsset[];
}

export interface FetchOptions {
  quality?: string;
  mode?: 'gui' | 'headless';
  noSubs?: boolean;
  subLangs?: string[];
}

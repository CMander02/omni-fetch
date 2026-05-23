import { httpGet } from '../../core/http.ts';
import { fmtDuration, fmtSize, sanitize, nowUserTime, fmtUserTime } from '../../core/format.ts';
import type { FetchResult, MediaAsset } from '../../core/types.ts';

export async function fetchXiaoyuzhou(url: string): Promise<FetchResult> {
  const html = await httpGet(url, { Referer: 'https://www.xiaoyuzhoufm.com/' });
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('__NEXT_DATA__ not found');
  const data = JSON.parse(m[1]);

  const isPodcast = url.includes('/podcast/');
  const raw = isPodcast ? data?.props?.pageProps?.podcast : data?.props?.pageProps?.episode;
  if (!raw) throw new Error(`${isPodcast ? 'Podcast' : 'Episode'} data not found`);

  if (isPodcast) {
    const p = raw;
    const recentEps = (p.episodes ?? []).map((ep: any) => ({
      eid: ep.eid,
      title: ep.title ?? '',
      pubDate: fmtUserTime(ep.pubDate),
      duration: ep.duration ?? 0,
      playCount: ep.playCount ?? 0,
      commentCount: ep.commentCount ?? 0,
      episodeUrl: `https://www.xiaoyuzhoufm.com/episode/${ep.eid}`,
      mediaUrl: ep.enclosure?.url ?? ep.media?.source?.url ?? '',
    }));

    const meta = {
      source: 'xiaoyuzhou', type: 'podcast',
      pid: p.pid, title: p.title ?? '', author: p.author ?? '',
      brief: p.brief ?? '', description: p.description ?? '',
      subscriptionCount: p.subscriptionCount ?? 0,
      episodeCount: p.episodeCount ?? 0,
      coverUrl: p.image?.picUrl ?? '',
      latestEpisodePubDate: fmtUserTime(p.latestEpisodePubDate),
      url,
      podcasters: (p.podcasters ?? []).map((h: any) => ({
        uid: h.uid, nickname: h.nickname ?? '', bio: h.bio ?? '',
        avatar: h.avatar?.picture?.picUrl ?? '',
        profileUrl: `https://www.xiaoyuzhoufm.com/user/${h.uid}`,
      })),
      recentEpisodes: recentEps,
    };

    const epLines = recentEps.map((ep: any, i: number) =>
      `| ${i + 1} | [${ep.title}](${ep.episodeUrl}) | ${ep.pubDate?.slice(0, 10)} | ${fmtDuration(ep.duration)} | ${ep.playCount} |`,
    );
    const body = [
      `## 频道简介\n\n${p.brief ?? ''}\n`,
      p.description ? `## 描述\n\n${p.description}\n` : '',
      `## 最近节目\n\n| # | 标题 | 发布 | 时长 | 播放 |\n|---|---|---|---|---|\n${epLines.join('\n')}\n`,
    ].join('\n');

    const media: MediaAsset[] = p.image?.picUrl
      ? [{ url: p.image.picUrl, type: 'image', filename: 'cover.jpg' }]
      : [];

    return {
      platform: 'xiaoyuzhou', url, title: p.title ?? '',
      fetched_at: nowUserTime(),
      meta, body_markdown: body, media,
    };
  }

  const ep = raw;
  const mediaUrl = ep.enclosure?.url ?? ep.media?.source?.url ?? '';
  const meta = {
    source: 'xiaoyuzhou', type: 'episode',
    eid: ep.eid, pid: ep.pid, title: ep.title ?? '',
    pubDate: fmtUserTime(ep.pubDate),
    duration: ep.duration ?? 0,
    duration_fmt: fmtDuration(ep.duration ?? 0),
    playCount: ep.playCount ?? 0,
    favoriteCount: ep.favoriteCount ?? 0,
    commentCount: ep.commentCount ?? 0,
    mediaUrl,
    mediaMimeType: ep.media?.mimeType ?? '',
    mediaSize: ep.media?.size ?? 0,
    mediaSize_fmt: fmtSize(ep.media?.size ?? 0),
    coverUrl: ep.image?.picUrl ?? '',
    description: ep.description ?? '',
    hasTranscript: !!(ep.transcript?.mediaId || ep.transcriptMediaId),
    url,
  };

  const body = [
    ep.description ? `## 节目简介\n\n${ep.description}\n` : '',
    ep.shownotes ? `## Shownotes\n\n${ep.shownotes}\n` : '',
    mediaUrl ? `## 媒体文件\n\n[🎧 下载音频](${mediaUrl})\n\n大小: ${fmtSize(ep.media?.size ?? 0)}  时长: ${fmtDuration(ep.duration ?? 0)}\n` : '',
  ].filter(Boolean).join('\n');

  const media: MediaAsset[] = [];
  if (ep.image?.picUrl) media.push({ url: ep.image.picUrl, type: 'image', filename: 'cover.jpg' });
  if (mediaUrl) media.push({
    url: mediaUrl, type: 'audio',
    filename: `${sanitize(ep.title ?? 'episode')}.m4a`,
    size: ep.media?.size ?? 0,
  });

  return {
    platform: 'xiaoyuzhou', url, title: ep.title ?? '',
    fetched_at: nowUserTime(),
    meta, body_markdown: body, media,
  };
}

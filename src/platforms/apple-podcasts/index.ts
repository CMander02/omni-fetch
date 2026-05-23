import { httpGet } from '../../core/http.ts';
import { fmtDuration, sanitize, nowUserTime, fmtUserTime } from '../../core/format.ts';
import type { FetchResult, MediaAsset } from '../../core/types.ts';
import { parseApplePodcastsUrl } from './detect.ts';

const LOOKUP_BASE = 'https://itunes.apple.com/lookup';

interface ItunesResult {
  wrapperType?: string;       // 'track' (show) or 'podcastEpisode'
  kind?: string;
  trackId?: number;
  trackName?: string;
  collectionId?: number;
  collectionName?: string;
  artistName?: string;
  description?: string;
  shortDescription?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  episodeUrl?: string;
  previewUrl?: string;
  episodeFileExtension?: string;
  episodeContentType?: string;
  episodeGuid?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
  collectionViewUrl?: string;
  // For shows this is sometimes Array<{name,id}>, for episodes it's string[].
  genres?: Array<string | { name?: string; id?: string }>;
  primaryGenreName?: string;
  trackCount?: number;
}

function normGenres(g: ItunesResult['genres']): string[] {
  if (!Array.isArray(g)) return [];
  return g.map(x => typeof x === 'string' ? x : (x.name ?? '')).filter(Boolean);
}

async function lookup(collectionId: string, country: string): Promise<ItunesResult[]> {
  // entity=podcastEpisode returns the show row plus every episode.
  // country only affects pricing/region badges; episode payload itself is consistent.
  const url = `${LOOKUP_BASE}?id=${collectionId}&entity=podcastEpisode&limit=200&country=${country}`;
  const text = await httpGet(url, { Accept: 'application/json' });
  const data = JSON.parse(text);
  return Array.isArray(data.results) ? data.results : [];
}

export async function fetchApplePodcasts(url: string): Promise<FetchResult> {
  const target = parseApplePodcastsUrl(url);
  if (!target) throw new Error(`无法解析 Apple Podcasts URL: ${url}`);

  const results = await lookup(target.collectionId, target.country);
  if (results.length === 0) throw new Error('Apple iTunes lookup 返回空结果（播客不存在或国家区域不可用）');

  const show = results.find(r => r.wrapperType === 'track' && r.kind === 'podcast');
  const episodes = results.filter(r => r.wrapperType === 'podcastEpisode');

  if (target.kind === 'episode') {
    const ep = episodes.find(e => String(e.trackId) === target.episodeId);
    if (!ep) throw new Error(`未在播客中找到 episode trackId=${target.episodeId}`);
    return buildEpisodeResult(url, target, ep, show);
  }
  if (!show) throw new Error('Apple iTunes lookup 返回数据中未找到 podcast 主条目');
  return buildShowResult(url, target, show, episodes);
}

function buildEpisodeResult(
  url: string,
  target: Extract<NonNullable<ReturnType<typeof parseApplePodcastsUrl>>, { kind: 'episode' }>,
  ep: ItunesResult,
  show: ItunesResult | undefined,
): FetchResult {
  const durationSec = ep.trackTimeMillis ? Math.round(ep.trackTimeMillis / 1000) : 0;
  const releaseTime = fmtUserTime(ep.releaseDate);

  const meta: Record<string, unknown> = {
    source: 'apple-podcasts',
    kind: 'episode',
    trackId: ep.trackId,
    collectionId: ep.collectionId ?? show?.collectionId ?? target.collectionId,
    title: ep.trackName ?? '',
    author: ep.artistName ?? show?.artistName ?? '',
    show: ep.collectionName ?? show?.collectionName ?? '',
    show_url: ep.collectionViewUrl ?? show?.collectionViewUrl ?? '',
    description: ep.description ?? ep.shortDescription ?? '',
    publish_time: releaseTime,
    duration: durationSec,
    duration_fmt: durationSec ? fmtDuration(durationSec) : '',
    audio_url: ep.episodeUrl ?? '',
    audio_ext: ep.episodeFileExtension ?? 'mp3',
    audio_mime: ep.episodeContentType ?? '',
    artwork: ep.artworkUrl600 ?? show?.artworkUrl600 ?? '',
    feed_url: ep.feedUrl ?? show?.feedUrl ?? '',
    episode_guid: ep.episodeGuid ?? '',
    genres: normGenres(ep.genres ?? show?.genres),
    track_view_url: ep.trackViewUrl ?? '',
    url,
  };

  const body = [
    `**播客**: [${ep.collectionName ?? ''}](${ep.collectionViewUrl ?? show?.collectionViewUrl ?? ''})`,
    `**作者**: ${ep.artistName ?? show?.artistName ?? ''}`,
    `**时长**: ${durationSec ? fmtDuration(durationSec) : '未知'}`,
    ep.episodeUrl ? `**音频**: [${ep.episodeUrl}](${ep.episodeUrl})` : '',
    ep.feedUrl ? `**RSS**: [${ep.feedUrl}](${ep.feedUrl})` : '',
  ].filter(Boolean).join('  \n');

  const media: MediaAsset[] = [];
  if (ep.artworkUrl600) {
    media.push({ url: ep.artworkUrl600, type: 'image', filename: 'cover.jpg' });
  }
  if (ep.episodeUrl) {
    media.push({
      url: ep.episodeUrl,
      type: 'audio',
      filename: `${sanitize(ep.trackName ?? 'episode')}.${ep.episodeFileExtension ?? 'm4a'}`,
    });
  }

  return {
    platform: 'apple-podcasts',
    url,
    title: ep.trackName ?? '(无标题)',
    fetched_at: nowUserTime(),
    meta,
    body_markdown: body,
    media,
  };
}

function buildShowResult(
  url: string,
  _target: Extract<NonNullable<ReturnType<typeof parseApplePodcastsUrl>>, { kind: 'show' }>,
  show: ItunesResult,
  episodes: ItunesResult[],
): FetchResult {
  const meta: Record<string, unknown> = {
    source: 'apple-podcasts',
    kind: 'show',
    collectionId: show.collectionId ?? show.trackId,
    title: show.collectionName ?? show.trackName ?? '',
    author: show.artistName ?? '',
    description: show.description ?? '',
    feed_url: show.feedUrl ?? '',
    artwork: show.artworkUrl600 ?? '',
    track_view_url: show.collectionViewUrl ?? show.trackViewUrl ?? '',
    genres: normGenres(show.genres),
    episode_count: show.trackCount ?? episodes.length,
    url,
  };

  const lines: string[] = [
    `**作者**: ${show.artistName ?? ''}`,
    `**分类**: ${normGenres(show.genres).join(' · ')}`,
    `**剧集数**: ${show.trackCount ?? episodes.length}`,
    show.feedUrl ? `**RSS**: [${show.feedUrl}](${show.feedUrl})` : '',
  ].filter(Boolean);

  if (episodes.length) {
    lines.push('', `## 最近 ${Math.min(20, episodes.length)} 集`, '');
    lines.push('| # | 标题 | 发布 | 时长 |');
    lines.push('|---|---|---|---|');
    // Sort by releaseDate desc
    episodes.sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
    for (let i = 0; i < Math.min(20, episodes.length); i++) {
      const ep = episodes[i];
      const date = (ep.releaseDate ?? '').slice(0, 10);
      const dur = ep.trackTimeMillis ? fmtDuration(Math.round(ep.trackTimeMillis / 1000)) : '';
      const link = ep.trackViewUrl ?? '';
      lines.push(`| ${i + 1} | [${ep.trackName ?? ''}](${link}) | ${date} | ${dur} |`);
    }
  }

  const media: MediaAsset[] = show.artworkUrl600
    ? [{ url: show.artworkUrl600, type: 'image', filename: 'cover.jpg' }]
    : [];

  return {
    platform: 'apple-podcasts',
    url,
    title: show.collectionName ?? show.trackName ?? '(无标题)',
    fetched_at: nowUserTime(),
    meta,
    body_markdown: lines.join('\n'),
    media,
  };
}

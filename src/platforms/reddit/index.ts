/**
 * Reddit via the public `.json` trick.
 *   https://www.reddit.com/r/<sub>/comments/<id>/.json  → [postListing, commentsListing]
 *   https://www.reddit.com/r/<sub>/top.json             → listing of posts
 *   https://www.reddit.com/user/<id>/about.json         → user profile
 *
 * Reddit's API requires a non-default user-agent. We use httpGet's pool to
 * stay polite.
 */
import { httpGet } from '../../core/http.ts';
import { fmtUserTime, nowUserTime } from '../../core/format.ts';
import type { FetchResult, MediaAsset } from '../../core/types.ts';
import { parseRedditUrl, type RedditTarget } from './detect.ts';

const MAX_COMMENTS = 50;
const UA = 'omnifetch/2.0 (+https://github.com/cmander02/omnifetch)';

async function fetchJson(url: string): Promise<any> {
  const text = await httpGet(url, { 'User-Agent': UA, Accept: 'application/json' });
  return JSON.parse(text);
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

interface RedditPost {
  id: string;
  subreddit: string;
  title: string;
  author: string;
  selftext?: string;
  url?: string;            // external url for link posts
  permalink: string;
  created_utc: number;
  score: number;
  upvote_ratio?: number;
  num_comments: number;
  over_18?: boolean;
  thumbnail?: string;
  preview?: { images?: Array<{ source: { url: string } }> };
  media?: any;
  is_video?: boolean;
  post_hint?: string;      // 'image' | 'link' | 'self' | 'hosted:video'
}

interface RedditComment {
  id: string;
  author: string;
  body: string;
  created_utc: number;
  score: number;
  replies?: { data?: { children: Array<{ kind: string; data: any }> } } | '';
  depth?: number;
}

export async function fetchReddit(url: string): Promise<FetchResult> {
  const target = parseRedditUrl(url);
  if (!target) throw new Error(`无法解析 Reddit URL: ${url}`);

  if (target.kind === 'post') return buildPostResult(url, target.subreddit, target.postId);
  if (target.kind === 'post-short') {
    // Short link → resolve to canonical URL then re-route.
    const text = await httpGet(`https://redd.it/${target.postId}`, { 'User-Agent': UA });
    const canon = text.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1];
    if (!canon) throw new Error('无法解析 redd.it 短链');
    return fetchReddit(canon);
  }
  if (target.kind === 'subreddit') return buildSubredditResult(url, target.subreddit);
  return buildUserResult(url, target.userId);
}

async function buildPostResult(url: string, sub: string, postId: string): Promise<FetchResult> {
  const data = await fetchJson(`https://www.reddit.com/r/${sub}/comments/${postId}.json?limit=${MAX_COMMENTS}`);
  if (!Array.isArray(data) || data.length < 2) throw new Error('Reddit 返回数据格式异常');

  const post: RedditPost = data[0].data.children[0].data;
  const commentChildren: Array<{ kind: string; data: RedditComment }> = data[1].data.children;

  const time = fmtUserTime(new Date(post.created_utc * 1000));
  const isVideo = !!post.is_video || post.post_hint === 'hosted:video';
  const isImage = post.post_hint === 'image';
  const externalUrl = post.url && !post.url.includes('reddit.com') ? post.url : '';

  const media: MediaAsset[] = [];
  if (isImage && post.url) {
    media.push({ url: post.url, type: 'image', filename: post.url.split('/').pop() || 'image.jpg' });
  } else if (post.preview?.images?.[0]?.source?.url) {
    const previewUrl = decodeHtml(post.preview.images[0].source.url);
    media.push({ url: previewUrl, type: 'image', filename: 'preview.jpg' });
  }
  if (isVideo && post.media?.reddit_video?.fallback_url) {
    media.push({
      url: post.media.reddit_video.fallback_url,
      type: 'video',
      filename: `${post.id}.mp4`,
    });
  }

  const meta: Record<string, unknown> = {
    source: 'reddit',
    kind: 'post',
    post_id: post.id,
    subreddit: post.subreddit,
    title: post.title,
    author: post.author,
    author_profile: `https://www.reddit.com/user/${post.author}`,
    publish_time: time,
    score: post.score,
    upvote_ratio: post.upvote_ratio,
    comment_count: post.num_comments,
    nsfw: !!post.over_18,
    external_url: externalUrl,
    permalink: `https://www.reddit.com${post.permalink}`,
    url,
  };

  const lines: string[] = [];
  lines.push(`**r/${post.subreddit}**  ·  **u/${post.author}**  ·  ⬆ ${post.score}  ·  💬 ${post.num_comments}`);
  if (externalUrl) lines.push(`**外链**: [${externalUrl}](${externalUrl})`);
  if (post.selftext) lines.push('', post.selftext);

  // Flatten visible comments breadth-first.
  if (commentChildren.length > 0) {
    lines.push('', `## 评论（已加载 ≤${MAX_COMMENTS} 条）`, '');
    let loaded = 0;
    const walk = (children: Array<{ kind: string; data: RedditComment }>, depth: number) => {
      for (const c of children) {
        if (loaded >= MAX_COMMENTS) return;
        if (c.kind !== 't1') continue; // skip 'more' placeholders
        loaded++;
        const indent = '  '.repeat(depth);
        const ts = fmtUserTime(new Date(c.data.created_utc * 1000));
        const body = (c.data.body ?? '').split('\n').join(`\n${indent}  `);
        lines.push(`${indent}- **u/${c.data.author}** · ${ts} · ⬆ ${c.data.score}\n${indent}  ${body}`);
        const reps = c.data.replies;
        if (reps && typeof reps === 'object' && reps.data?.children) {
          walk(reps.data.children, depth + 1);
        }
      }
    };
    walk(commentChildren, 0);
    meta.comments_loaded = loaded;
  }

  return {
    platform: 'reddit', url, title: post.title,
    fetched_at: nowUserTime(),
    meta, body_markdown: lines.join('\n'), media,
  };
}

async function buildSubredditResult(url: string, sub: string): Promise<FetchResult> {
  const data = await fetchJson(`https://www.reddit.com/r/${sub}/about.json`);
  const top = await fetchJson(`https://www.reddit.com/r/${sub}/top.json?limit=20&t=week`);

  const info = data.data ?? {};
  const posts = (top.data?.children ?? []).map((c: any) => c.data as RedditPost);

  const meta: Record<string, unknown> = {
    source: 'reddit',
    kind: 'subreddit',
    name: info.display_name ?? sub,
    title: info.title ?? '',
    description: info.public_description ?? '',
    subscribers: info.subscribers ?? 0,
    active_users: info.active_user_count ?? 0,
    created_at: info.created_utc ? fmtUserTime(new Date(info.created_utc * 1000)) : '',
    nsfw: !!info.over18,
    url,
  };

  const lines: string[] = [
    `**订阅数**: ${(info.subscribers ?? 0).toLocaleString()}  ·  **在线**: ${info.active_user_count ?? 0}`,
    info.public_description ? `\n${info.public_description}\n` : '',
    '', `## 本周热门（${posts.length} 帖）`, '',
    '| # | 标题 | u/ | ⬆ | 💬 |',
    '|---|---|---|---|---|',
  ];
  posts.forEach((p: RedditPost, i: number) => {
    const link = `https://www.reddit.com${p.permalink}`;
    lines.push(`| ${i + 1} | [${p.title}](${link}) | ${p.author} | ${p.score} | ${p.num_comments} |`);
  });

  return {
    platform: 'reddit', url, title: `r/${sub}`,
    fetched_at: nowUserTime(),
    meta, body_markdown: lines.join('\n'),
    media: info.icon_img ? [{ url: info.icon_img, type: 'image', filename: 'icon.jpg' }] : [],
  };
}

async function buildUserResult(url: string, userId: string): Promise<FetchResult> {
  const data = await fetchJson(`https://www.reddit.com/user/${userId}/about.json`);
  const info = data.data ?? {};

  const meta: Record<string, unknown> = {
    source: 'reddit',
    kind: 'user',
    user_id: info.name ?? userId,
    author: info.name ?? userId,
    author_profile: `https://www.reddit.com/user/${userId}`,
    publish_time: info.created_utc ? fmtUserTime(new Date(info.created_utc * 1000)) : '',
    link_karma: info.link_karma ?? 0,
    comment_karma: info.comment_karma ?? 0,
    is_employee: !!info.is_employee,
    is_gold: !!info.is_gold,
    is_mod: !!info.is_mod,
    description: info.subreddit?.public_description ?? '',
    url,
  };

  const body = [
    `**Link karma**: ${info.link_karma ?? 0}`,
    `**Comment karma**: ${info.comment_karma ?? 0}`,
    `**加入时间**: ${meta.publish_time}`,
    info.subreddit?.public_description ? `\n## About\n\n${info.subreddit.public_description}` : '',
  ].filter(Boolean).join('  \n');

  const media: MediaAsset[] = info.icon_img
    ? [{ url: decodeHtml(info.icon_img), type: 'image', filename: 'avatar.jpg' }]
    : [];

  return {
    platform: 'reddit', url, title: `Reddit user u/${userId}`,
    fetched_at: nowUserTime(),
    meta, body_markdown: body, media,
  };
}

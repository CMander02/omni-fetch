/**
 * Hacker News via the public Firebase API.
 *   https://hacker-news.firebaseio.com/v0/item/<id>.json
 *   https://hacker-news.firebaseio.com/v0/user/<id>.json
 *
 * Item types: 'story' | 'comment' | 'job' | 'poll' | 'pollopt'.
 * We always fetch the requested item; for stories we also walk the comment
 * tree breadth-first up to MAX_COMMENTS to give a useful conversational
 * snapshot without blasting the API.
 */
import { fmtUserTime, nowUserTime } from '../../core/format.ts';
import type { FetchResult } from '../../core/types.ts';
import { parseHnUrl } from './detect.ts';

const API = 'https://hacker-news.firebaseio.com/v0';
const MAX_COMMENTS = 50;

interface HnItem {
  id: number;
  type?: 'story' | 'comment' | 'job' | 'poll' | 'pollopt';
  by?: string;
  time?: number;
  title?: string;
  text?: string;
  url?: string;
  score?: number;
  descendants?: number;
  kids?: number[];
  parent?: number;
  dead?: boolean;
  deleted?: boolean;
}

interface HnUser {
  id: string;
  created?: number;
  karma?: number;
  about?: string;
  submitted?: number[];
}

async function fetchItem(id: number | string): Promise<HnItem | null> {
  const res = await fetch(`${API}/item/${id}.json`);
  if (!res.ok) return null;
  return await res.json() as HnItem | null;
}

async function fetchUser(id: string): Promise<HnUser | null> {
  const res = await fetch(`${API}/user/${id}.json`);
  if (!res.ok) return null;
  return await res.json() as HnUser | null;
}

function htmlToPlain(html: string): string {
  // HN stores comments as light HTML (<p>, <i>, <a>, <pre>). Convert minimally.
  return html
    .replace(/<p>/gi, '\n\n')
    .replace(/<\/p>/gi, '')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/gi, (_, c) => '\n```\n' + c + '\n```\n')
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function walkComments(rootIds: number[], cap: number): Promise<{ md: string; loaded: number }> {
  // Breadth-first, depth-stamped, up to `cap` comments.
  const queue: Array<{ id: number; depth: number }> = rootIds.map(id => ({ id, depth: 0 }));
  const lines: string[] = [];
  let loaded = 0;
  while (queue.length > 0 && loaded < cap) {
    const batch = queue.splice(0, 10);
    const items = await Promise.all(batch.map(b => fetchItem(b.id).then(it => ({ it, depth: b.depth }))));
    for (const { it, depth } of items) {
      if (!it || it.dead || it.deleted) continue;
      loaded++;
      const indent = '  '.repeat(depth);
      const author = it.by ?? '[deleted]';
      const time = it.time ? fmtUserTime(new Date(it.time * 1000)) : '';
      const text = it.text ? htmlToPlain(it.text) : '';
      lines.push(`${indent}- **${author}** · ${time}\n${indent}  ${text.split('\n').join(`\n${indent}  `)}`);
      if (it.kids && loaded < cap) {
        for (const kid of it.kids.slice(0, 5)) queue.push({ id: kid, depth: depth + 1 });
      }
    }
  }
  return { md: lines.join('\n\n'), loaded };
}

export async function fetchHackerNews(url: string): Promise<FetchResult> {
  const target = parseHnUrl(url);
  if (!target) throw new Error(`无法解析 HN URL: ${url}`);

  if (target.kind === 'front') {
    throw new Error('HN 首页暂未支持，请粘贴具体 item 或 user 链接');
  }
  if (target.kind === 'user') {
    return await buildUserResult(url, target.id);
  }
  return await buildItemResult(url, target.id);
}

async function buildItemResult(url: string, id: string): Promise<FetchResult> {
  const item = await fetchItem(id);
  if (!item) throw new Error(`HN item ${id} 不存在`);

  const time = item.time ? fmtUserTime(new Date(item.time * 1000)) : '';
  const text = item.text ? htmlToPlain(item.text) : '';
  const isStory = item.type === 'story' || item.type === 'job' || item.type === 'poll';
  const title = item.title ?? (text ? text.slice(0, 80) + (text.length > 80 ? '…' : '') : `HN ${item.type} ${id}`);

  const meta: Record<string, unknown> = {
    source: 'hackernews',
    kind: item.type ?? 'item',
    item_id: item.id,
    title: item.title ?? '',
    author: item.by ?? '',
    author_profile: item.by ? `https://news.ycombinator.com/user?id=${item.by}` : '',
    publish_time: time,
    score: item.score ?? 0,
    comment_count: item.descendants ?? 0,
    external_url: item.url ?? '',
    parent_id: item.parent ?? null,
    url,
  };

  const lines: string[] = [];
  if (item.url) lines.push(`**外链**: [${item.url}](${item.url})`);
  if (item.score !== undefined) lines.push(`**分数**: ${item.score}  ·  **评论数**: ${item.descendants ?? 0}`);
  if (text) lines.push('', text);

  if (isStory && item.kids?.length) {
    lines.push('', `## 评论（已加载 ≤${MAX_COMMENTS} 条）`, '');
    const { md, loaded } = await walkComments(item.kids, MAX_COMMENTS);
    meta.comments_loaded = loaded;
    lines.push(md);
  }

  return {
    platform: 'hackernews', url, title,
    fetched_at: nowUserTime(),
    meta, body_markdown: lines.join('\n'), media: [],
  };
}

async function buildUserResult(url: string, id: string): Promise<FetchResult> {
  const user = await fetchUser(id);
  if (!user) throw new Error(`HN user ${id} 不存在`);

  const created = user.created ? fmtUserTime(new Date(user.created * 1000)) : '';
  const about = user.about ? htmlToPlain(user.about) : '';

  const meta: Record<string, unknown> = {
    source: 'hackernews',
    kind: 'user',
    user_id: user.id,
    author: user.id,
    author_profile: `https://news.ycombinator.com/user?id=${user.id}`,
    publish_time: created,
    karma: user.karma ?? 0,
    description: about,
    submitted_count: user.submitted?.length ?? 0,
    url,
  };

  const body = [
    `**Karma**: ${user.karma ?? 0}`,
    `**加入时间**: ${created}`,
    `**提交数**: ${user.submitted?.length ?? 0}`,
    about ? `\n## About\n\n${about}` : '',
  ].filter(Boolean).join('  \n');

  return {
    platform: 'hackernews', url, title: `HN user @${user.id}`,
    fetched_at: nowUserTime(),
    meta, body_markdown: body, media: [],
  };
}

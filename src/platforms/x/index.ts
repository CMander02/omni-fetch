import type { FetchResult, FetchOptions, MediaAsset } from '../../core/types.ts';
import { nowUserTime, fmtUserTime } from '../../core/format.ts';
import { openPage } from '../../core/browser.ts';

export type XTarget =
  | { kind: 'user'; handle: string }
  | { kind: 'status'; handle: string; statusId: string };

// Routes that look like /username but are actually X internal pages.
const RESERVED_PATHS = new Set([
  'home', 'explore', 'notifications', 'messages', 'i', 'compose',
  'search', 'settings', 'login', 'signup', 'tos', 'privacy', 'about',
  'jobs', 'logout', 'follower_requests', 'hashtag',
]);

export function parseXUrl(url: string): XTarget | null {
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (!/^(?:www\.|mobile\.)?(x|twitter)\.com$/.test(host)) return null;

  // Drop leading slash, split path
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  const handle = parts[0];
  if (RESERVED_PATHS.has(handle.toLowerCase())) return null;
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) return null;

  // /<handle>
  if (parts.length === 1) return { kind: 'user', handle };

  // /<handle>/with_replies | /media | /likes — treat as user page
  if (parts.length === 2 && ['with_replies', 'media', 'likes', 'following', 'followers', 'verified_followers'].includes(parts[1])) {
    return { kind: 'user', handle };
  }

  // /<handle>/status/<id>
  if (parts.length >= 3 && parts[1] === 'status' && /^\d+$/.test(parts[2])) {
    return { kind: 'status', handle, statusId: parts[2] };
  }

  return null;
}

// Browser-side extraction script — runs inside Playwright page.evaluate.
// Kept as a string template (no TS) since it runs in the page context.
const EXTRACT_USER_SCRIPT = `(() => {
  const text = (el) => el?.innerText ?? '';
  const userNameEl = document.querySelector('[data-testid="UserName"]');
  const lines = text(userNameEl).split('\\n').map(s => s.trim()).filter(Boolean);
  const displayName = lines[0] ?? '';
  const handle = (lines.find(l => l.startsWith('@')) ?? '').replace(/^@/, '');
  const desc = text(document.querySelector('[data-testid="UserDescription"]'));
  const headerItems = text(document.querySelector('[data-testid="UserProfileHeader_Items"]'));
  const joined = text(document.querySelector('[data-testid="UserJoinDate"]'));

  // Avatar: try direct img, then background-image fallback
  const avatarContainer = document.querySelector('[data-testid^="UserAvatar-Container-"]');
  let avatar = avatarContainer?.querySelector('img')?.src ?? '';
  if (!avatar && avatarContainer) {
    const bgEl = avatarContainer.querySelector('[style*="background-image"]');
    const m = bgEl?.getAttribute('style')?.match(/background-image:\\s*url\\("([^"]+)"\\)/);
    avatar = m?.[1] ?? '';
  }
  // Banner: link wrapper, may use img or background-image
  const bannerLink = document.querySelector('a[href*="header_photo"]');
  let banner = bannerLink?.querySelector('img')?.src ?? '';
  if (!banner && bannerLink) {
    const bgEl = bannerLink.querySelector('[style*="background-image"]');
    const m = bgEl?.getAttribute('style')?.match(/background-image:\\s*url\\("([^"]+)"\\)/);
    banner = m?.[1] ?? '';
  }

  // followers / following counts
  const followersA = document.querySelector('a[href$="/verified_followers"], a[href$="/followers"]');
  const followingA = document.querySelector('a[href$="/following"]');
  const followers = text(followersA);
  const following = text(followingA);

  // Verified badge
  const verified = !!document.querySelector('[data-testid="UserName"] svg[aria-label*="erified" i]');

  // Pinned + recent tweets (first ~10)
  const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, 10);
  const tweets = arts.map(a => ({
    handle: (Array.from(a.querySelectorAll('a[role="link"]')).find(el => el.textContent.startsWith('@'))?.textContent ?? '').replace(/^@/, ''),
    link: a.querySelector('a[href*="/status/"]')?.href ?? '',
    time: a.querySelector('time')?.dateTime ?? '',
    text: a.querySelector('[data-testid="tweetText"]')?.innerText ?? '',
    pinned: !!Array.from(a.querySelectorAll('[data-testid="socialContext"]')).find(el => /Pinned|置顶/.test(el.textContent)),
  }));

  return { displayName, handle, desc, headerItems, joined, avatar, banner, followers, following, verified, tweets };
})()`;

const EXTRACT_STATUS_SCRIPT = `(() => {
  const text = (el) => el?.innerText ?? '';
  const arts = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  const all = arts.map(a => {
    const handle = (Array.from(a.querySelectorAll('a[role="link"]')).find(el => el.textContent.startsWith('@'))?.textContent ?? '').replace(/^@/, '');
    const userNameLine = text(a.querySelector('[data-testid="User-Name"]')).split('\\n');
    const displayName = userNameLine[0] ?? '';
    const link = a.querySelector('a[href*="/status/"]')?.href ?? '';
    const statusId = link.match(/\\/status\\/(\\d+)/)?.[1] ?? '';
    const time = a.querySelector('time')?.dateTime ?? '';
    const tweetText = text(a.querySelector('[data-testid="tweetText"]'));
    // images / videos inside the tweet
    const images = Array.from(a.querySelectorAll('[data-testid="tweetPhoto"] img')).map(img => img.src);
    const hasVideo = !!a.querySelector('video, [data-testid="videoPlayer"], [data-testid="videoComponent"]');
    // engagement: reply / retweet / like counts via aria-label
    const labels = {};
    for (const el of a.querySelectorAll('[role="group"] [aria-label]')) {
      const l = el.getAttribute('aria-label') ?? '';
      labels.raw = (labels.raw ?? '') + l + ' | ';
    }
    return { handle, displayName, link, statusId, time, text: tweetText, images, hasVideo, labels: labels.raw ?? '' };
  });
  return all;
})()`;

export async function fetchX(url: string, _opts: FetchOptions = {}): Promise<FetchResult> {
  const target = parseXUrl(url);
  if (!target) throw new Error(`无法解析 X URL: ${url}`);

  const { page, closeContext } = await openPage(url);
  try {
    try {
      if (target.kind === 'user') {
        await page.waitForSelector('[data-testid="UserName"]', { timeout: 15000 });
      } else {
        await page.waitForSelector('article[data-testid="tweet"]', { timeout: 15000 });
      }
    } catch { /* keep going — extraction may still find partial data */ }

    // Scroll a bit to coax conversation tweets / pinned tweet into view
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      await page.waitForTimeout(500);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);

    return target.kind === 'user'
      ? await buildUserResult(page, target, url)
      : await buildStatusResult(page, target, url);
  } finally {
    await closeContext();
  }
}

async function buildUserResult(page: any, target: { kind: 'user'; handle: string }, url: string): Promise<FetchResult> {
  const data: any = await page.evaluate(EXTRACT_USER_SCRIPT);

  const meta: Record<string, unknown> = {
    source: 'x',
    kind: 'user',
    author: data.displayName,
    author_id: data.handle,
    author_profile: `https://x.com/${data.handle}`,
    author_avatar: data.avatar,
    banner: data.banner,
    verified: data.verified ?? false,
    description: data.desc,
    profile_items: data.headerItems,
    joined: data.joined,
    followers_text: data.followers,
    following_text: data.following,
    url,
  };

  const title = data.displayName ? `${data.displayName} (@${data.handle})` : `@${target.handle}`;

  const lines: string[] = [];
  if (data.desc) lines.push(`> ${data.desc.split('\n').join('\n> ')}\n`);
  if (data.headerItems) lines.push(`**主页信息**: ${data.headerItems.split('\n').join('  ·  ')}\n`);
  const stats: string[] = [];
  if (data.following) stats.push(data.following);
  if (data.followers) stats.push(data.followers);
  if (stats.length) lines.push(`**统计**: ${stats.join('  ·  ')}\n`);

  if (data.tweets?.length) {
    lines.push(`\n## 近期帖子 (${data.tweets.length})\n`);
    for (const t of data.tweets) {
      const tag = t.pinned ? ' 📌' : '';
      const time = t.time ? ` · ${t.time.slice(0, 19).replace('T', ' ')}` : '';
      lines.push(`- [${t.link}](${t.link})${tag}${time}`);
      if (t.text) {
        const indented = t.text.split('\n').map((l: string) => `  ${l}`).join('\n');
        lines.push(`${indented}\n`);
      }
    }
  }

  return {
    platform: 'x', url, title,
    fetched_at: nowUserTime(),
    meta, body_markdown: lines.join('\n'), media: [],
  };
}

export interface XTweet {
  handle: string;
  displayName?: string;
  link?: string;
  statusId: string;
  time?: string;
  text?: string;
  images?: string[];
  hasVideo?: boolean;
}

/**
 * Detect a thread: starting from the main tweet (matching statusId), include
 * every following tweet by the same author in DOM order. Stop at the first
 * tweet by a different author (reply from someone else).
 *
 * Exported for unit testing.
 */
export function collectThread(tweets: XTweet[], mainStatusId: string): XTweet[] {
  if (tweets.length === 0) return [];
  let mainIdx = tweets.findIndex(t => t.statusId === mainStatusId);
  if (mainIdx < 0) mainIdx = 0;
  const main = tweets[mainIdx];
  const out: XTweet[] = [main];
  for (let i = mainIdx + 1; i < tweets.length; i++) {
    const t = tweets[i];
    if (t.handle.toLowerCase() === main.handle.toLowerCase()) out.push(t);
    else break;
  }
  return out;
}

async function buildStatusResult(
  page: any,
  target: { kind: 'status'; handle: string; statusId: string },
  url: string,
): Promise<FetchResult> {
  const tweets: XTweet[] = await page.evaluate(EXTRACT_STATUS_SCRIPT);

  const threadTweets = collectThread(tweets, target.statusId);
  if (threadTweets.length === 0) throw new Error('未找到主推文（页面可能未加载或需要登录）');
  const main = threadTweets[0];

  const isThread = threadTweets.length > 1;
  const media: MediaAsset[] = [];
  for (const t of threadTweets) {
    for (const img of t.images ?? []) {
      if (img) media.push({ url: img, type: 'image', filename: `tweet_${t.statusId}_${media.length + 1}.jpg` });
    }
  }

  const meta: Record<string, unknown> = {
    source: 'x',
    kind: isThread ? 'thread' : 'tweet',
    status_id: main.statusId,
    author: main.displayName || main.handle,
    author_id: main.handle,
    author_profile: `https://x.com/${main.handle}`,
    publish_time: fmtUserTime(main.time),
    publish_timestamp: main.time ? Math.floor(new Date(main.time).getTime() / 1000) : 0,
    thread_count: threadTweets.length,
    has_video: threadTweets.some(t => t.hasVideo),
    url,
  };

  const title = isThread
    ? `@${main.handle} thread · ${threadTweets.length} tweets`
    : `@${main.handle}: ${(main.text ?? '').split('\n')[0].slice(0, 80)}`;

  const lines: string[] = [];
  if (isThread) {
    lines.push(`> ${threadTweets.length}-tweet thread by ${main.displayName ? main.displayName + ' ' : ''}@${main.handle}\n`);
    for (let i = 0; i < threadTweets.length; i++) {
      const t = threadTweets[i];
      lines.push(`### ${i + 1}/${threadTweets.length}`);
      if (t.time) lines.push(`*${t.time.slice(0, 19).replace('T', ' ')}* · [link](${t.link})`);
      lines.push('');
      lines.push(t.text || '*(no text)*');
      if (t.images?.length) {
        for (const img of t.images) lines.push(`\n![](${img})`);
      }
      lines.push('');
    }
  } else {
    lines.push(main.text || '*(no text)*');
    if (main.images?.length) {
      lines.push('');
      for (const img of main.images) lines.push(`![](${img})`);
    }
    if (main.hasVideo) lines.push('\n*(此帖含视频，可用 `--media` 或对该 URL 跑 yt-dlp 下载)*');
  }

  return {
    platform: 'x', url, title,
    fetched_at: nowUserTime(),
    meta, body_markdown: lines.join('\n'), media,
  };
}

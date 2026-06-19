import { httpGet } from '../../core/http.ts';
import { sanitize, nowUserTime, fmtUserTime } from '../../core/format.ts';
import type { FetchResult, MediaAsset, FetchOptions } from '../../core/types.ts';
import { fetchSubtitles, detectYtdlp } from '../../core/ytdlp.ts';

function rednoteRandomUA(): string {
  const major = 120 + Math.floor(Math.random() * 16);
  const build = Math.floor(Math.random() * 9999);
  const safari = 537 + Math.floor(Math.random() * 68);
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/${safari}.36 (KHTML, like Gecko) Chrome/${major}.0.${build}.0 Safari/${safari}.36`;
}

async function resolveRednoteUrl(input: string): Promise<string> {
  if (!/xhslink\.com/.test(input)) return input;
  const m = input.match(/(https?:\/\/xhslink\.com\/[a-zA-Z0-9/]+)/);
  if (!m) throw new Error('无法提取 xhslink 短链');
  const res = await fetch(m[1], {
    redirect: 'follow',
    headers: { 'User-Agent': rednoteRandomUA(), Referer: 'https://www.xiaohongshu.com/' },
  });
  return res.url;
}

function extractPostId(url: string): { postId: string; xsecToken: string; canonicalUrl: string } | null {
  const m = url.match(/\/(?:explore|discovery\/item|item|user\/profile)\/([a-zA-Z0-9]+)/);
  const u = (() => { try { return new URL(url); } catch { return null; } })();
  if (!m || !u) return null;
  const postId = m[1];
  const xsecToken = u.searchParams.get('xsec_token') ?? '';
  if (!xsecToken) return null;
  const canonicalUrl = `${u.origin}${u.pathname}?xsec_token=${xsecToken}`;
  return { postId, xsecToken, canonicalUrl };
}

function findNoteDict(value: unknown, postId: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNoteDict(item, postId);
      if (found) return found;
    }
    return null;
  }
  const obj = value as Record<string, unknown>;
  const id = obj.noteId ?? obj.id ?? obj.note_id;
  if (id === postId && ('type' in obj || 'video' in obj || 'imageList' in obj)) return obj;
  for (const child of Object.values(obj)) {
    const found = findNoteDict(child, postId);
    if (found) return found;
  }
  return null;
}


function extractProfileId(url: string): { userId: string; canonicalUrl: string } | null {
  const u = (() => { try { return new URL(url); } catch { return null; } })();
  if (!u) return null;
  const m = u.pathname.match(/\/user\/profile\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  return { userId: m[1], canonicalUrl: `${u.origin}${u.pathname}${u.search}` };
}

function findUserDict(value: unknown, userId: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUserDict(item, userId);
      if (found) return found;
    }
    return null;
  }
  const obj = value as Record<string, unknown>;
  const id = obj.userId ?? obj.id ?? obj.user_id;
  if (id === userId && ('nickname' in obj || 'nickName' in obj || 'desc' in obj || 'redId' in obj)) return obj;
  for (const child of Object.values(obj)) {
    const found = findUserDict(child, userId);
    if (found) return found;
  }
  return null;
}

function collectProfileNotes(value: unknown, userId: string, out: Map<string, Record<string, unknown>> = new Map()): Map<string, Record<string, unknown>> {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectProfileNotes(item, userId, out);
    return out;
  }
  const obj = value as Record<string, unknown>;
  const id = obj.noteId ?? obj.id ?? obj.note_id;
  const user = obj.user as Record<string, unknown> | undefined;
  const objUserId = obj.userId ?? obj.user_id ?? user?.userId ?? user?.id;
  const looksLikeNote = typeof id === 'string' && ('title' in obj || 'displayTitle' in obj || 'desc' in obj || 'cover' in obj || 'imageList' in obj);
  if (looksLikeNote && (!objUserId || objUserId === userId)) out.set(id, obj);
  for (const child of Object.values(obj)) collectProfileNotes(child, userId, out);
  return out;
}

function countVal(...values: unknown[]): number {
  for (const v of values) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v.replace(/,/g, ''));
      if (!Number.isNaN(n)) return n;
    }
  }
  return 0;
}

function firstString(...values: unknown[]): string {
  for (const v of values) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

export async function fetchRednoteProfile(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const resolvedUrl = await resolveRednoteUrl(url);
  const info = extractProfileId(resolvedUrl);
  if (!info) throw new Error('无法解析小红书作者页 URL');

  const pageHtml = await httpGet(info.canonicalUrl, {
    Referer: 'https://www.xiaohongshu.com/',
    Cookie: 'webId=anonymous',
  });

  const stateM = pageHtml.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?})(?:<\/script>|;)/);
  if (!stateM) throw new Error('__INITIAL_STATE__ not found');
  const state = JSON.parse(stateM[1].replace(/:undefined/g, ':null'));
  const user = findUserDict(state, info.userId) ?? {};
  const notes = Array.from(collectProfileNotes(state, info.userId).values()).slice(0, 60);

  const nickname = firstString(user.nickname, user.nickName, user.name, user.userName) || info.userId;
  const avatar = firstString(user.avatar, user.images, user.image);
  const signature = firstString(user.desc, user.description, user.signature, user.introduction);
  const redId = firstString(user.redId, user.red_id, user.redid);
  const ipLocation = firstString(user.ipLocation, user.ip_location, user.location);
  const follows = countVal(user.follows, user.followingCount, user.following);
  const fans = countVal(user.fans, user.fansCount, user.followerCount, user.followers);
  const liked = countVal(user.liked, user.likedCount, user.likeCount, user.likes);

  const posts = notes.map((n: any) => {
    const noteId = String(n.noteId ?? n.id ?? n.note_id ?? '');
    const cover = n.cover?.urlDefault ?? n.cover?.url ?? n.imageList?.[0]?.urlDefault ?? n.imageList?.[0]?.url ?? '';
    const interact = n.interactInfo ?? n.interact_info ?? {};
    return {
      note_id: noteId,
      title: firstString(n.title, n.displayTitle, n.desc),
      desc: firstString(n.desc),
      type: firstString(n.type) || ((n.video || n.videoList) ? 'video' : 'normal'),
      cover_url: cover,
      like_count: countVal(interact.likedCount, interact.likeCount, n.likedCount),
      collect_count: countVal(interact.collectCount, n.collectCount),
      comment_count: countVal(interact.commentCount, n.commentCount),
      url: noteId ? `https://www.xiaohongshu.com/explore/${noteId}` : '',
    };
  }).filter((p) => p.note_id || p.title);

  const meta: Record<string, unknown> = {
    source: 'rednote',
    kind: 'profile',
    user_id: info.userId,
    username: nickname,
    nickname,
    red_id: redId,
    avatar,
    signature,
    ip_location: ipLocation,
    following_count: follows,
    follower_count: fans,
    liked_count: liked,
    posts_loaded: posts.length,
    posts,
    url: resolvedUrl,
  };

  const body = [
    signature ? `> ${signature}` : '',
    `**用户 ID**: ${info.userId}`,
    redId ? `**小红书号**: ${redId}` : '',
    ipLocation ? `**IP 属地**: ${ipLocation}` : '',
    `**关注/粉丝/获赞**: ${follows} / ${fans} / ${liked}`,
    '',
    `## 主页帖子（已加载 ${posts.length} 条）`,
    ...posts.map((p, i) => `${i + 1}. ${p.title || p.note_id}\n   - 类型: ${p.type} · 👍${p.like_count} · ☆${p.collect_count} · 💬${p.comment_count}\n   - ${p.url}`),
  ].filter(Boolean).join('\n\n');

  return {
    platform: 'rednote', url, title: nickname,
    fetched_at: nowUserTime(),
    meta, body_markdown: body, media: avatar ? [{ url: avatar, type: 'image', filename: 'avatar.jpg' }] : [],
  };
}

function rednoteTransformOriginal(urlStr: string): string {
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('xhscdn.com')) {
      const segs = u.pathname.split('/').filter(Boolean).slice(2);
      const last = segs.pop() ?? '';
      return `https://ci.xiaohongshu.com/${[...segs, last.split('!')[0]].join('/')}`;
    }
    if (u.hostname === 'ci.xiaohongshu.com') return `${u.origin}${u.pathname}`;
  } catch { /* ignore */ }
  return urlStr;
}

export async function fetchRednote(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const resolvedUrl = await resolveRednoteUrl(url);
  if (extractProfileId(resolvedUrl) && !resolvedUrl.includes('/explore/')) return fetchRednoteProfile(resolvedUrl, opts);
  const info = extractPostId(resolvedUrl);
  if (!info) throw new Error('无法解析小红书链接（需要包含 xsec_token）');

  const pageHtml = await httpGet(info.canonicalUrl, {
    Referer: 'https://www.xiaohongshu.com/',
    Cookie: 'webId=anonymous',
  });

  const stateM = pageHtml.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?})(?:<\/script>|;)/);
  if (!stateM) throw new Error('__INITIAL_STATE__ not found');
  const state = JSON.parse(stateM[1].replace(/:undefined/g, ':null'));

  const ndm = state?.note?.noteDetailMap ?? {};
  const wrapper = ndm[info.postId];
  let note: any =
    (wrapper?.note ?? wrapper?.noteInfo ?? (wrapper && typeof wrapper === 'object' && 'type' in wrapper ? wrapper : null)) ?? null;
  if (!note) note = findNoteDict(state, info.postId);
  if (!note) throw new Error('Note data not found');

  const isVideo = note.type === 'video' || (note.videoList?.length ?? 0) > 0;
  const title = note.title ?? note.desc ?? '';
  const media: MediaAsset[] = [];

  if (isVideo) {
    const stream = note.video?.media?.stream;
    let videoAsset: MediaAsset | null = null;
    for (const codec of ['h265', 'h264', 'av1', 'h266']) {
      const streams = stream?.[codec];
      if (!Array.isArray(streams) || streams.length === 0) continue;
      const s = streams[0];
      videoAsset = {
        url: s.masterUrl, type: 'video',
        filename: `${sanitize(title)}.mp4`,
        quality: s.qualityType ?? codec,
        width: s.width, height: s.height,
        size: s.size ?? 0,
        backupUrls: s.backupUrls ?? [],
      };
      break;
    }
    if (videoAsset) media.push(videoAsset);
  } else {
    (note.imageList ?? []).forEach((img: any, i: number) => {
      const origUrl = rednoteTransformOriginal(img.urlDefault || img.url);
      media.push({ url: origUrl, type: 'image', filename: `image_${i + 1}.jpg` });
    });
  }

  const coverUrl = note.imageList?.[0]?.urlDefault ?? note.video?.image?.firstFrameUrl ?? '';

  const user = (note.user ?? {}) as { nickname?: string; userId?: string; avatar?: string };
  const publishTs = typeof note.time === 'number' ? note.time : 0; // ms-since-epoch
  const updateTs = typeof note.lastUpdateTime === 'number' ? note.lastUpdateTime : 0;

  const meta: Record<string, unknown> = {
    source: 'rednote',
    postId: info.postId,
    title, isVideo,
    author: user.nickname ?? '',
    author_id: user.userId ?? '',
    author_avatar: user.avatar ?? '',
    author_profile: user.userId ? `https://www.xiaohongshu.com/user/profile/${user.userId}` : '',
    publish_time: fmtUserTime(publishTs),
    publish_timestamp: publishTs ? Math.floor(publishTs / 1000) : 0,
    update_time: fmtUserTime(updateTs),
    coverUrl,
    desc: note.desc ?? '',
    tags: (note.tagList ?? []).map((t: any) => t.name ?? t.id),
    likeCount: note.interactInfo?.likedCount ?? 0,
    collectCount: note.interactInfo?.collectCount ?? 0,
    commentCount: note.interactInfo?.commentCount ?? 0,
    url: resolvedUrl,
    mediaCount: media.filter((m) => m.type !== 'image' || !m.filename.includes('cover')).length,
  };

  let body = [
    (note.tagList ?? []).length ? `**标签**: ${(note.tagList as any[]).map((t: any) => `#${t.name ?? t.id}`).join(' ')}\n` : '',
    isVideo ? `**类型**: 视频\n` : `**图片数**: ${(note.imageList ?? []).length}\n`,
  ].filter(Boolean).join('\n');

  // 视频字幕（仅视频帖）
  if (isVideo && !opts.noSubs) {
    const ydl = detectYtdlp();
    if (ydl.available) {
      try {
        const sub = await fetchSubtitles(resolvedUrl, opts.subLangs);
        if (sub && sub.text) {
          meta.subtitles_lang = sub.lang;
          meta.subtitles_auto = sub.auto;
          body += `\n## 字幕 (${sub.lang}${sub.auto ? ', 自动生成' : ''})\n\n${sub.text}\n`;
          console.error(`  ✓ 字幕已抓取: ${sub.lang}`);
        }
      } catch { /* yt-dlp 可能不支持 rednote */ }
    }
  }

  return {
    platform: 'rednote', url, title,
    fetched_at: nowUserTime(),
    meta, body_markdown: body, media,
  };
}

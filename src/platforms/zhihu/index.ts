import { htmlToMarkdown } from '../../core/html.ts';
import { nowUserTime, fmtUserTime } from '../../core/format.ts';
import type { FetchResult, FetchOptions } from '../../core/types.ts';
import { openPage } from '../../core/browser.ts';

interface ZhihuTarget {
  kind: 'article' | 'answer';
  articleId?: string;
  questionId?: string;
  answerId?: string;
  commentsScope: string; // for response url matching
}

function parseZhihuUrl(url: string): ZhihuTarget | null {
  const article = url.match(/zhuanlan\.zhihu\.com\/p\/(\d+)/);
  if (article) {
    return { kind: 'article', articleId: article[1], commentsScope: `articles/${article[1]}` };
  }
  const answer = url.match(/zhihu\.com\/question\/(\d+)\/answer\/(\d+)/);
  if (answer) {
    return {
      kind: 'answer',
      questionId: answer[1],
      answerId: answer[2],
      commentsScope: `answers/${answer[2]}`,
    };
  }
  return null;
}

export async function fetchZhihu(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const target = parseZhihuUrl(url);
  if (!target) throw new Error(`无法解析知乎 URL: ${url}`);

  const captured: { html: string; commentsApi: any[] } = { html: '', commentsApi: [] };

  const { page, closeContext } = await openPage(url, opts.mode ?? 'gui');
  try {
    page.on('response', async (response: any) => {
      if (response.url().includes(`comment_v5/${target.commentsScope}/root_comment`)) {
        try { captured.commentsApi.push(await response.json()); } catch { /* ignore */ }
      }
    });

    await page.waitForSelector('.RichText.ztext, .Post-RichText, .AnswerItem, .AnswerCard', { timeout: 15000 }).catch(() => { /* ignore */ });
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1000);
    captured.html = await page.content();
  } finally {
    await closeContext();
  }

  // Zhihu timestamps are unix seconds; surface in user-configured format.
  const fmtTsSv = (ts: number | null | undefined) => ts ? fmtUserTime(new Date(ts * 1000)) : '';

  // Parse initialState
  const scriptRe = /<script[^>]*>(\{"initialState":[\s\S]*?)<\/script>/g;
  let entity: any = null;
  let questionEntity: any = null;
  let sm: RegExpExecArray | null;
  while ((sm = scriptRe.exec(captured.html)) !== null) {
    try {
      const st = JSON.parse(sm[1]);
      const ents = st.initialState?.entities;
      if (!ents) continue;
      if (target.kind === 'article') {
        const c = ents.articles?.[target.articleId!];
        if (c) { entity = c; break; }
      } else {
        const a = ents.answers?.[target.answerId!];
        if (a) {
          entity = a;
          questionEntity = ents.questions?.[target.questionId!] ?? null;
          break;
        }
      }
    } catch { continue; }
  }

  let title = '';
  let author: any = null;
  let topics: string[] = [];
  let bodyMd = '';
  let created: number | undefined;
  let updated: number | undefined;
  let ipInfo = '';
  const engagement = { voteup: 0, liked: 0, favorites: 0, comments: 0, shares: 0 };

  if (entity) {
    if (target.kind === 'article') {
      title = String(entity.title ?? '');
      bodyMd = entity.content ? htmlToMarkdown(String(entity.content)) : '';
      topics = (entity.topics as { name: string }[] ?? []).map((t) => t.name);
      created = entity.created;
      updated = entity.updated;
      engagement.voteup = entity.voteupCount ?? 0;
      engagement.liked = entity.likedCount ?? 0;
      engagement.favorites = entity.favlistsCount ?? 0;
      engagement.comments = entity.commentCount ?? 0;
      engagement.shares = entity.reaction?.statistics?.shareCount ?? 0;
    } else {
      // answer
      title = String(questionEntity?.title ?? '');
      bodyMd = entity.content ? htmlToMarkdown(String(entity.content)) : '';
      topics = (questionEntity?.topics as { name: string }[] ?? []).map((t) => t.name);
      created = entity.createdTime ?? entity.created;
      updated = entity.updatedTime ?? entity.updated;
      engagement.voteup = entity.voteupCount ?? 0;
      engagement.comments = entity.commentCount ?? 0;
      engagement.favorites = entity.favoriteCount ?? 0;
    }
    author = entity.author;
    ipInfo = entity.ipInfo ?? '';
  }

  if (!title && !bodyMd) {
    const modeHint = opts.mode === 'headless'
      ? 'headless 模式未拿到公开内容，可能遇到登录墙/反爬；请改用已登录 Chrome CDP（默认 gui）或换可公开访问 URL'
      : '未从页面初始状态解析到知乎内容；请确认 Chrome CDP 已启动并登录知乎';
    throw new Error(modeHint);
  }

  const comments: any[] = [];
  for (const pg of captured.commentsApi as { data?: any[] }[]) {
    for (const c of (pg.data ?? [])) {
      comments.push({
        id: c.id, author_name: c.author?.name ?? '', author_id: c.author?.id ?? '',
        content: c.content ?? '', created_time: fmtTsSv(c.created_time),
        like_count: c.like_count ?? 0, is_author: !!c.is_author,
        child_comments: (c.child_comments ?? []).map((ch: any) => ({
          author_name: ch.author?.name ?? '', content: ch.content ?? '',
          created_time: fmtTsSv(ch.created_time), like_count: ch.like_count ?? 0,
        })),
      });
    }
  }

  const meta: Record<string, unknown> = {
    source: 'zhihu',
    kind: target.kind,
    article_id: target.articleId ?? '',
    question_id: target.questionId ?? '',
    answer_id: target.answerId ?? '',
    title,
    author_name: author?.name ?? '',
    author_uuid: author?.id ?? '',
    author_uid: author?.uid ?? '',
    author_url_token: author?.urlToken ?? '',
    author_profile: author?.urlToken ? `https://www.zhihu.com/people/${author.urlToken}` : '',
    created_at: fmtTsSv(created),
    updated_at: fmtTsSv(updated),
    ip_info: ipInfo,
    topics,
    ...engagement,
    comments_loaded: comments.length,
    url,
  };

  const commentMd = comments.length > 0 ? [
    `\n---\n\n## 评论（共 ${engagement.comments} 条，已加载 ${comments.length} 条）\n`,
    ...comments.map((c) => {
      const tag = c.is_author ? ' #作者' : '';
      const lines = [
        `> [!quote] **${c.author_name}**${tag} · ${c.created_time} · 👍${c.like_count}`,
        `> \`${c.author_id}\``, `>`, `> ${c.content}`,
      ];
      for (const ch of c.child_comments) {
        lines.push(`>`, `> > **${ch.author_name}** · ${ch.created_time} · 👍${ch.like_count}`, `> > ${ch.content}`);
      }
      return lines.join('\n');
    }),
  ].join('\n\n') : '';

  const body = bodyMd + commentMd;

  return {
    platform: 'zhihu', url, title,
    fetched_at: nowUserTime(),
    meta, body_markdown: body, media: [],
  };
}

import type { FetchResult } from './types.ts';
import { yamlStr } from './format.ts';

export function toMarkdown(r: FetchResult): string {
  const m = r.meta;
  const lines = ['---'];

  lines.push(`title: ${yamlStr(r.title)}`);
  lines.push(`url: ${r.url}`);
  lines.push(`source: ${String(m.source ?? r.platform)}`);
  lines.push(`fetched_at: "${r.fetched_at}"`);

  const skip = new Set([
    'source', 'title', 'url', 'description', 'body_markdown', 'content_html',
    'recentEpisodes', 'podcasters', 'pages', 'tags', 'topics',
  ]);

  for (const [k, v] of Object.entries(m)) {
    if (skip.has(k) || v === null || v === undefined || v === '') continue;
    if (Array.isArray(v)) {
      if (v.length === 0) continue;
      lines.push(`${k}:`);
      for (const item of v) lines.push(`  - ${yamlStr(String(item))}`);
    } else if (typeof v === 'object') {
      continue;
    } else {
      lines.push(`${k}: ${yamlStr(String(v))}`);
    }
  }

  const tagList = (m.tags ?? m.topics) as string[] | undefined;
  if (tagList?.length) {
    lines.push('tags:');
    for (const t of tagList) lines.push(`  - ${yamlStr(t)}`);
  }

  lines.push('---');
  const frontmatter = lines.join('\n');

  const desc = String(m.description ?? m.desc ?? m.brief ?? '');

  // Author + publish time line. Field names vary per platform — pick whatever
  // exists. Author handle/id is shown alongside the display name when available.
  const authorName = String(
    m.author ?? m.author_name ?? m.owner ?? m.uploader ?? m.account_name ?? '',
  );
  const authorId = String(
    m.author_id ?? m.author_url_token ?? m.account_id ?? m.owner_mid ?? m.author_uuid ?? '',
  );
  const authorProfile = String(m.author_profile ?? '');
  const publishTime = String(m.publish_time ?? m.created_at ?? m.pubDate ?? m.upload_date ?? '');

  const metaBits: string[] = [];
  if (authorName) {
    const idPart = authorId ? ` (${authorId})` : '';
    metaBits.push(authorProfile
      ? `**作者**: [${authorName}](${authorProfile})${idPart}`
      : `**作者**: ${authorName}${idPart}`);
  }
  if (publishTime) metaBits.push(`**发布**: ${publishTime}`);

  const header = [
    `\n# ${r.title}\n`,
    metaBits.length ? metaBits.join('  ·  ') + '\n' : '',
    desc ? `> ${desc}\n` : '',
  ].filter(Boolean).join('\n');

  return `${frontmatter}${header}\n${r.body_markdown}\n${mediaSummary(r)}`;
}

/**
 * Aggregate list of every media asset discovered.
 *
 * This is intentionally separate from any media references the body may already
 * contain — it's a flat at-a-glance index for downstream tooling and humans.
 * Returns an empty string when there's nothing to list.
 */
function mediaSummary(r: FetchResult): string {
  if (!r.media || r.media.length === 0) return '';
  const lines = ['', '## 多媒体内容', ''];
  for (let i = 0; i < r.media.length; i++) {
    const a = r.media[i];
    const quality = a.quality ? ` · ${a.quality}` : '';
    const dims = (a.width && a.height) ? ` · ${a.width}×${a.height}` : '';
    lines.push(`${i + 1}. **[${a.type}]** \`${a.filename}\`${quality}${dims}`);
    lines.push(`   ${a.url}`);
  }
  return lines.join('\n') + '\n';
}

export function toJSON(r: FetchResult): string {
  return JSON.stringify(
    { ...r.meta, title: r.title, url: r.url, fetched_at: r.fetched_at, body_markdown: r.body_markdown, media: r.media },
    null,
    2,
  );
}

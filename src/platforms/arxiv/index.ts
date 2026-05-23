import { httpGet } from '../../core/http.ts';
import { nowUserTime, fmtUserTime } from '../../core/format.ts';
import type { FetchResult, MediaAsset } from '../../core/types.ts';
import { parseArxivId } from './detect.ts';

const API_BASE = 'https://export.arxiv.org/api/query';

interface ArxivEntry {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  updated: string;
  categories: string[];
  primaryCategory: string;
  doi: string;
  journalRef: string;
  comment: string;
  pdfUrl: string;
  absUrl: string;
}

function pickTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function pickAttr(xml: string, tag: string, attr: string): string {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseEntry(xml: string): ArxivEntry {
  const title = decodeXml(pickTag(xml, 'title')).replace(/\s+/g, ' ');
  const summary = decodeXml(pickTag(xml, 'summary')).trim();

  const authors: string[] = [];
  const authorRe = /<author>([\s\S]*?)<\/author>/gi;
  let am: RegExpExecArray | null;
  while ((am = authorRe.exec(xml)) !== null) {
    const name = pickTag(am[1], 'name');
    if (name) authors.push(decodeXml(name));
  }

  const categories: string[] = [];
  const catRe = /<category\b[^>]*\bterm="([^"]+)"/gi;
  let cm: RegExpExecArray | null;
  while ((cm = catRe.exec(xml)) !== null) categories.push(cm[1]);

  const primaryCategory = pickAttr(xml, 'arxiv:primary_category', 'term');

  // Links: rel="alternate" → abs HTML, title="pdf" → pdf URL
  let absUrl = '';
  let pdfUrl = '';
  const linkRe = /<link\b[^>]*>/gi;
  let lm: RegExpExecArray | null;
  while ((lm = linkRe.exec(xml)) !== null) {
    const tag = lm[0];
    const href = tag.match(/\bhref="([^"]+)"/)?.[1] ?? '';
    const rel = tag.match(/\brel="([^"]+)"/)?.[1] ?? '';
    const t = tag.match(/\btitle="([^"]+)"/)?.[1] ?? '';
    if (t === 'pdf') pdfUrl = href;
    else if (rel === 'alternate') absUrl = href;
  }

  return {
    id: pickTag(xml, 'id'),
    title,
    summary,
    authors,
    published: pickTag(xml, 'published'),
    updated: pickTag(xml, 'updated'),
    categories,
    primaryCategory,
    doi: pickTag(xml, 'arxiv:doi'),
    journalRef: pickTag(xml, 'arxiv:journal_ref'),
    comment: pickTag(xml, 'arxiv:comment'),
    pdfUrl,
    absUrl,
  };
}

export async function fetchArxiv(url: string): Promise<FetchResult> {
  const parsed = parseArxivId(url);
  if (!parsed) throw new Error(`无法识别 arxiv ID: ${url}`);

  // Always query the canonical id (without version); api returns the latest by default.
  // If user wanted a specific version, append it to the id_list query.
  const queryId = parsed.version ? `${parsed.id}${parsed.version}` : parsed.id;
  const apiUrl = `${API_BASE}?id_list=${encodeURIComponent(queryId)}`;
  const xml = await httpGet(apiUrl, { Accept: 'application/atom+xml' });

  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/i);
  if (!entryMatch) throw new Error('arxiv API 未返回 entry（论文不存在或 ID 无效）');
  const entry = parseEntry(entryMatch[1]);

  const versionLabel = parsed.version || (entry.id.match(/v(\d+)$/)?.[0] ?? '');
  const meta: Record<string, unknown> = {
    source: 'arxiv',
    arxiv_id: parsed.id,
    version: versionLabel,
    title: entry.title,
    author: entry.authors.join(', '),
    authors: entry.authors,
    abs_url: entry.absUrl || `https://arxiv.org/abs/${parsed.id}${versionLabel}`,
    pdf_url: entry.pdfUrl || `https://arxiv.org/pdf/${parsed.id}${versionLabel}.pdf`,
    primary_category: entry.primaryCategory,
    categories: entry.categories,
    publish_time: fmtUserTime(entry.published),
    update_time: fmtUserTime(entry.updated),
    doi: entry.doi,
    journal_ref: entry.journalRef,
    comment: entry.comment,
    description: entry.summary,
    url,
  };

  // Abstract is rendered as the header `> ...` block via meta.description.
  // Body holds the secondary metadata (categories, comment, journal, doi, pdf).
  const finalPdfUrl = entry.pdfUrl || `https://arxiv.org/pdf/${parsed.id}${versionLabel}.pdf`;
  const body = [
    entry.primaryCategory ? `**Category**: ${entry.primaryCategory}${entry.categories.length > 1 ? ' (also: ' + entry.categories.filter(c => c !== entry.primaryCategory).join(', ') + ')' : ''}` : '',
    entry.comment ? `**Comment**: ${entry.comment}` : '',
    entry.journalRef ? `**Journal-ref**: ${entry.journalRef}` : '',
    entry.doi ? `**DOI**: [${entry.doi}](https://doi.org/${entry.doi})` : '',
    `**PDF**: [${finalPdfUrl}](${finalPdfUrl})`,
  ].filter(Boolean).join('  \n');

  const media: MediaAsset[] = entry.pdfUrl ? [{
    url: entry.pdfUrl,
    type: 'document',
    filename: `${parsed.id}${versionLabel}.pdf`,
  }] : [];

  return {
    platform: 'arxiv', url, title: entry.title,
    fetched_at: nowUserTime(),
    meta, body_markdown: body, media,
  };
}

import type { Platform } from '../../core/types.ts';

// arxiv new-style ID: YYMM.NNNNN (4-digit YYMM, 4-5 digit sequence), optional vN
// Examples: 2401.12345, 1706.03762, 0706.0001v1
const NEW_ID_RE = /\b(\d{4}\.\d{4,5})(v\d+)?\b/;

export interface ArxivId {
  id: string;        // canonical ID without version, e.g. "2401.12345"
  version: string;   // "v2" or "" if not specified
}

export function parseArxivId(input: string): ArxivId | null {
  if (!input) return null;
  const s = input.trim();

  // Match anywhere in the string: handles abs URL, pdf URL (.pdf suffix),
  // bare id, "arxiv:" prefix, etc.
  const m = s.match(NEW_ID_RE);
  if (!m) return null;
  return { id: m[1], version: m[2] ?? '' };
}

export function detect(url: string): Platform | null {
  if (!url) return null;
  // Arxiv host always wins
  if (/^https?:\/\/(?:www\.)?arxiv\.org\//i.test(url)) {
    return parseArxivId(url) ? 'arxiv' : null;
  }
  // arXiv: prefix
  if (/^arxiv:/i.test(url) && parseArxivId(url)) return 'arxiv';
  // Bare new-style id (must match the whole string, with optional version)
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(url)) return 'arxiv';
  return null;
}

import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeScratchDir } from './paths.ts';

export interface Subtitle {
  lang: string;
  text: string;
  auto: boolean;
}

export interface YtdlpInfo {
  id: string;
  title: string;
  description?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  upload_date?: string;
  view_count?: number;
  like_count?: number;
  webpage_url?: string;
  thumbnail?: string;
  ext?: string;
  extractor?: string;
  extractor_key?: string;
  tags?: string[];
  categories?: string[];
}

export function detectYtdlp(): { available: boolean; version?: string } {
  try {
    const r = spawnSync('yt-dlp', ['--version'], { encoding: 'utf-8' });
    if (r.status === 0) return { available: true, version: r.stdout.trim() };
  } catch { /* not installed */ }
  return { available: false };
}

export function ytdlpInstallHint(): string {
  return [
    '✗ yt-dlp 未安装（视频字幕抓取需要）',
    '  推荐安装：uv tool install yt-dlp',
    '  或：pipx install yt-dlp / brew install yt-dlp / winget install yt-dlp.yt-dlp',
    '  跳过字幕：使用 --no-subs',
  ].join('\n');
}

export function srtToPlainText(srt: string): string {
  if (!srt) return '';
  const lines = srt.split(/\r?\n/);
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { out.push(''); continue; }
    if (/^\d+$/.test(line)) continue;
    if (/-->/.test(line)) continue;
    out.push(line);
  }
  // dedupe consecutive identical lines (common in auto-subs)
  const deduped: string[] = [];
  for (const l of out) {
    if (deduped[deduped.length - 1] !== l) deduped.push(l);
  }
  return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function fetchSubtitles(
  url: string,
  langs: string[] = ['zh', 'zh-CN', 'zh-Hans', 'en'],
): Promise<Subtitle | null> {
  const tmp = makeScratchDir('subs');
  try {
    const args = [
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', langs.join(','),
      '--skip-download',
      '--convert-subs', 'srt',
      '--no-warnings',
      '-o', join(tmp, '%(id)s.%(ext)s'),
      url,
    ];
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      p.on('close', (code) => resolve(code === 0));
      p.on('error', () => resolve(false));
    });
    if (!ok) return null;

    const files = readdirSync(tmp).filter((f) => f.endsWith('.srt'));
    if (files.length === 0) return null;
    // prefer the order of requested langs
    let chosen: string | null = null;
    let chosenLang = '';
    let auto = false;
    for (const lang of langs) {
      const m = files.find((f) => f.includes(`.${lang}.`));
      if (m) {
        chosen = m;
        chosenLang = lang;
        break;
      }
    }
    if (!chosen) {
      chosen = files[0];
      const m = chosen.match(/\.([a-zA-Z-]+)\.srt$/);
      chosenLang = m?.[1] ?? '';
    }
    auto = /auto/i.test(chosen);
    const text = srtToPlainText(readFileSync(join(tmp, chosen), 'utf-8'));
    return { lang: chosenLang, text, auto };
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export async function fetchVideoInfo(url: string): Promise<YtdlpInfo | null> {
  return new Promise((resolve) => {
    const p = spawn('yt-dlp', ['--dump-json', '--no-warnings', '--skip-download', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', (code) => {
      if (code !== 0) return resolve(null);
      try { resolve(JSON.parse(out) as YtdlpInfo); }
      catch { resolve(null); }
    });
    p.on('error', () => resolve(null));
  });
}

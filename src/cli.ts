#!/usr/bin/env node
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve, join, isAbsolute, extname } from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs } from './cli-parse.ts';
import { detectPlatform } from './detect.ts';
import { sanitize } from './core/format.ts';
import { omnifetchHome, cleanScratch } from './core/paths.ts';
import { timezoneCommand } from './commands/timezone.ts';
import { toMarkdown, toJSON } from './core/render.ts';
import { downloadMedia } from './media/download.ts';
import { fetchWechat } from './platforms/wechat/index.ts';
import { fetchXiaoyuzhou } from './platforms/xiaoyuzhou/index.ts';
import { fetchBilibili } from './platforms/bilibili/index.ts';
import { fetchRednote } from './platforms/rednote/index.ts';
import { fetchZhihu } from './platforms/zhihu/index.ts';
import { fetchX } from './platforms/x/index.ts';
import { fetchArxiv } from './platforms/arxiv/index.ts';
import { fetchApplePodcasts } from './platforms/apple-podcasts/index.ts';
import { fetchHackerNews } from './platforms/hackernews/index.ts';
import { fetchReddit } from './platforms/reddit/index.ts';
import { fetchPixiv } from './platforms/pixiv/index.ts';
import { fetchFallback } from './platforms/fallback/index.ts';
import { fetchYtdlpGeneric } from './platforms/ytdlp-generic/index.ts';
import type { FetchResult, FetchOptions, Platform } from './core/types.ts';

const PLATFORMS: Array<{ key: Platform; label: string; example: string; auth?: string }> = [
  { key: 'arxiv',          label: 'arXiv',          example: '2401.12345 / arxiv.org/abs/<id>' },
  { key: 'wechat',         label: '微信公众号',     example: 'mp.weixin.qq.com/s/...' },
  { key: 'xiaoyuzhou',     label: '小宇宙',         example: 'xiaoyuzhoufm.com/podcast|episode/...' },
  { key: 'apple-podcasts', label: 'Apple Podcasts', example: 'podcasts.apple.com/<country>/podcast/<slug>/idXXX[?i=YYY]' },
  { key: 'bilibili',       label: 'Bilibili',       example: 'bilibili.com/video/BV... 或 BVxxxxxx' },
  { key: 'rednote',        label: '小红书 (rednote)', example: 'xiaohongshu.com/...?xsec_token=... 或 xhslink.com/...' },
  { key: 'zhihu',          label: '知乎',           example: 'zhuanlan.zhihu.com/p/... 或 zhihu.com/question/.../answer/...', auth: 'Chrome CDP' },
  { key: 'x',              label: 'X (Twitter)',    example: 'x.com/<user> 或 x.com/<user>/status/<id>',                     auth: 'Chrome CDP' },
  { key: 'hackernews',     label: 'Hacker News',    example: 'news.ycombinator.com/item?id=X 或 /user?id=X' },
  { key: 'reddit',         label: 'Reddit',         example: 'reddit.com/r/<sub>/comments/<id>/... 或 /r/<sub> 或 /user/<name> 或 redd.it/<id>' },
  { key: 'pixiv',          label: 'Pixiv',          example: 'pixiv.net/artworks/<id> 或 /users/<id> 或 /novel/show.php?id=<id>', auth: 'Chrome CDP' },
  { key: 'fallback',       label: '通用文章抓取',   example: '任意 URL → defuddle 抽正文 → 失败回退 yt-dlp' },
  { key: 'ytdlp-generic',  label: '视频 fallback',  example: 'YouTube/Vimeo 等 1000+ 站点（fallback 链最后一步）' },
];

function usage(): void {
  console.error(`
omnifetch / of — 统一内容抓取工具

用法:
  of <url|id>                       输出 markdown 到屏幕（含 header + 正文 + 多媒体清单）
  of <url|id> --json                输出 JSON 到屏幕
  of <url|id> --export [path]       导出到文件（默认 markdown，路径不传时用 sanitize(标题).<ext>）
  of <url|id> --export --type json  导出为 JSON
  of <url|id> --export --with-media y   导出同时下载媒体到同目录 media/<标题>/

  of help                           显示本帮助
  of platforms                      列出所有支持平台
  of detect <url>                   只识别平台，不抓取
  of version                        显示版本号
  of clean                          清空 ~/.omnifetch/cache/ 里的临时残留
  of timezone / of tz               查看/设置时区与时间格式（of timezone help 看更多）

支持平台:
${PLATFORMS.map(p => `  ${p.key.padEnd(16)} ${p.label.padEnd(20)} ${p.example}${p.auth ? `  (需 ${p.auth})` : ''}`).join('\n')}

常用选项:
  --markdown               显式 markdown（与默认相同）
  --json                   输出 JSON
  --export [path]          导出到文件
  --type markdown|json     与 --export 配合，指定文件格式（默认 markdown）
  --with-media y|n         与 --export 配合，是否同时下载媒体（默认 n）
  --out <file>             兼容旧用法，等同 --export <file>
  --media / --media-dir    兼容旧用法
  --quality 360p|480p|720p|1080p   B 站视频画质（默认 360p）
  --mode gui|headless      知乎/X 浏览器模式（默认 gui）
  --no-subs                视频不抓字幕（默认开启字幕，需 yt-dlp）
  --sub-langs zh,en        字幕语言（逗号分隔）
  --quiet                  抑制 stderr 日志，只输出正文
  -h, --help               显示帮助
  -e, --export             导出到文件
  -v, --version            显示版本号

示例:
  of https://mp.weixin.qq.com/s/Xvoh9hGnqe7rJ_ns5tRwBQ
  of 1706.03762 --export                     # → ./Attention Is All You Need.md
  of BV1GJ411x7h7 --export ~/Notes --with-media y
  of https://x.com/elonmusk --json
  of detect https://podcasts.apple.com/cn/podcast/x/id1634356920?i=1000765020256
`);
}

function listPlatforms(): void {
  process.stdout.write('支持的平台：\n\n');
  for (const p of PLATFORMS) {
    process.stdout.write(`  ${p.key.padEnd(16)} ${p.label}\n`);
    process.stdout.write(`  ${''.padEnd(16)} 示例: ${p.example}\n`);
    if (p.auth) process.stdout.write(`  ${''.padEnd(16)} 登录: ${p.auth}\n`);
    process.stdout.write('\n');
  }
}

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    return String(pkg.version ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

function logger(quiet: boolean) {
  return (msg: string) => { if (!quiet) console.error(msg); };
}

function chooseFilePath(exportArg: string | boolean, type: string, title: string): string {
  const ext = type === 'json' ? 'json' : 'md';
  const filename = `${sanitize(title)}.${ext}`;
  if (typeof exportArg === 'string' && exportArg) {
    const abs = isAbsolute(exportArg) ? exportArg : resolve(exportArg);
    // If the path ends with a known extension, treat as file; if it's an
    // existing directory or has no extension, treat as a directory.
    if (extname(abs)) return abs;
    try {
      const st = statSync(abs);
      if (st.isDirectory()) return join(abs, filename);
    } catch { /* path doesn't exist yet */ }
    // No extension and not an existing dir → assume directory
    return join(abs, filename);
  }
  return resolve('.', filename);
}

async function fetchByPlatform(platform: Platform, url: string, opts: FetchOptions): Promise<FetchResult> {
  switch (platform) {
    case 'wechat':         return fetchWechat(url);
    case 'xiaoyuzhou':     return fetchXiaoyuzhou(url);
    case 'bilibili':       return fetchBilibili(url, opts);
    case 'rednote':        return fetchRednote(url, opts);
    case 'zhihu':          return fetchZhihu(url, opts);
    case 'x':              return fetchX(url, opts);
    case 'arxiv':          return fetchArxiv(url);
    case 'apple-podcasts': return fetchApplePodcasts(url);
    case 'hackernews':     return fetchHackerNews(url);
    case 'reddit':         return fetchReddit(url);
    case 'pixiv':          return fetchPixiv(url);
    case 'fallback':       return fetchFallback(url, opts);
    case 'ytdlp-generic':  return fetchYtdlpGeneric(url, opts);
  }
}

async function main(): Promise<void> {
  const { flags, url, rest } = parseArgs(process.argv);

  if (flags.help) { usage(); process.exit(0); }
  if (flags.version) { process.stdout.write(`omnifetch ${readVersion()}\n`); process.exit(0); }
  if (flags.platforms) { listPlatforms(); process.exit(0); }

  if (flags.timezone) {
    const code = await timezoneCommand(
      rest,
      flags.format ? String(flags.format) : undefined,
      flags.offset !== undefined ? String(flags.offset) : undefined,
    );
    process.exit(code);
  }

  if (flags.clean) {
    const r = cleanScratch();
    const mb = (r.bytes / 1048576).toFixed(2);
    process.stdout.write(`已清理 ${r.dirs} 个目录、${r.files} 个文件 (${mb} MB)\n位置: ${omnifetchHome()}/cache/\n`);
    process.exit(0);
  }

  if (flags.detect) {
    if (!url) { console.error('✗ detect 需要一个 URL 参数'); process.exit(1); }
    const p = detectPlatform(url);
    if (!p) { console.error(`✗ 无法识别: ${url}`); process.exit(1); }
    process.stdout.write(`${p}\n`);
    process.exit(0);
  }

  if (!url) { usage(); process.exit(1); }

  const platform = detectPlatform(url);
  if (!platform) {
    console.error(`✗ 无法识别平台且非 URL 格式: ${url}`);
    process.exit(1);
  }

  const quiet = !!flags.quiet;
  const log = logger(quiet);

  // Output format. `--json` overrides; otherwise default markdown (`--markdown` is a no-op alias).
  const outputType: 'json' | 'markdown' = flags.json ? 'json'
    : (flags.type === 'json' ? 'json' : 'markdown');

  // Export to file vs print to stdout.
  // Legacy: --out <file> behaves like --export <file>.
  const exportFlag = flags.export ?? (flags.out ? String(flags.out) : false);
  const exporting = exportFlag !== false && exportFlag !== undefined;

  // Media download. Legacy: --media is the same as --with-media y.
  const withMedia = flags['with-media']
    ? String(flags['with-media']).toLowerCase().startsWith('y')
    : !!flags.media;
  const mediaDir = flags['media-dir'] ? resolve(String(flags['media-dir'])) : null;

  const opts: FetchOptions = {
    quality: flags.quality ? String(flags.quality) : '360p',
    mode: (flags.mode === 'headless' ? 'headless' : 'gui'),
    noSubs: !!flags['no-subs'],
    subLangs: flags['sub-langs'] ? String(flags['sub-langs']).split(',') : undefined,
  };

  log(`平台: ${platform}  URL: ${url}`);

  let result: FetchResult;
  try {
    result = await fetchByPlatform(platform, url, opts);
  } catch (e: any) {
    console.error(`✗ 抓取失败: ${e.message}`);
    process.exit(1);
  }

  log(`✓ ${result.title}`);

  const output = outputType === 'json' ? toJSON(result) : toMarkdown(result);

  if (exporting) {
    const filePath = chooseFilePath(exportFlag as string | boolean, outputType, result.title);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, output, 'utf-8');
    log(`✓ 已保存: ${filePath}`);

    if (withMedia) {
      const mediaToDl = platform === 'wechat'
        ? result.media.filter((a) => a.type !== 'image')
        : result.media;
      if (mediaToDl.length === 0) {
        log('⚠ 该平台/内容无可下载媒体');
      } else {
        const dir = mediaDir ?? join(dirname(filePath), 'media', sanitize(result.title));
        log(`\n下载媒体 (${mediaToDl.length} 个) → ${dir}`);
        await downloadMedia(mediaToDl, dir, platform);
      }
    }
  } else {
    process.stdout.write(output);
    if (!output.endsWith('\n')) process.stdout.write('\n');

    if (withMedia) {
      const mediaToDl = platform === 'wechat'
        ? result.media.filter((a) => a.type !== 'image')
        : result.media;
      if (mediaToDl.length === 0) {
        log('⚠ 该平台/内容无可下载媒体');
      } else {
        const dir = mediaDir ?? join('.', 'media', sanitize(result.title));
        log(`\n下载媒体 (${mediaToDl.length} 个) → ${dir}`);
        await downloadMedia(mediaToDl, dir, platform);
      }
    }
  }
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });

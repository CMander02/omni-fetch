import { existsSync, mkdirSync, openSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sanitize } from '../core/format.ts';

interface AsrFlags {
  [key: string]: string | boolean;
}

interface SegmentTranscript {
  index: number;
  file: string;
  text: string;
}

interface JobInfo {
  job_id: string;
  input: string;
  title: string;
  source: string;
  output_dir: string;
  started_at: string;
  finished_at?: string;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

const DEFAULT_ASR_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_ASR_MODEL = 'whisper-large-v3-turbo';

export function asrUsage(): string {
  return `
音频 ASR 工作流:
  of asr <audio-file-or-url> [--background] [--title 标题] [--output-root output]
  of transcribe <audio-file-or-url> [同上]

功能:
  1. 将音频按块切分到临时目录
  2. 逐块调用 OpenAI-compatible 免费/低成本 ASR API
  3. 合并转写文本
  4. 生成简要概要、专有名词候选、批量润色后的完整文档
  5. 最终产物保存到 output/<source>/<task-title>/，中间 chunk 自动清理

默认 ASR API:
  OMNIFETCH_ASR_API_URL   默认 ${DEFAULT_ASR_URL}
  OMNIFETCH_ASR_API_KEY   API key（Groq/OpenAI-compatible endpoint 通常需要）
  OMNIFETCH_ASR_MODEL     默认 ${DEFAULT_ASR_MODEL}

可选 LLM 润色/总结:
  OMNIFETCH_LLM_API_URL   OpenAI-compatible chat completions endpoint
  OMNIFETCH_LLM_API_KEY
  OMNIFETCH_LLM_MODEL     默认 qwen/qwen3-32b

常用选项:
  --background            后台运行，立即返回 job 信息，适合长音频
  --title <title>         指定任务标题/输出目录名
  --output-root <dir>     输出根目录，默认 ./output
  --chunk-seconds <sec>   分块长度，默认 600 秒
  --asr-api-url <url>     覆盖 ASR API endpoint
  --asr-model <model>     覆盖 ASR model
  --language <lang>       传给 ASR API 的 language 参数，如 zh/en
  --mock-asr-text <text>  测试用：不调用 API，每块返回该文本
`;
}

export async function runAsrCommand(rest: string[], flags: AsrFlags): Promise<number> {
  const input = rest.find((x) => x !== 'asr' && x !== 'transcribe');
  if (!input || flags.help) {
    process.stderr.write(asrUsage());
    return input ? 0 : 1;
  }

  if (flags.background && !flags['no-background']) {
    return startBackground(input, flags);
  }

  const jobId = String(flags['job-id'] || makeJobId());
  const title = sanitize(String(flags.title || inferTitle(input))).slice(0, 120) || jobId;
  const source = sanitize(inferSource(input));
  const outputRoot = resolve(String(flags['output-root'] || 'output'));
  const outputDir = join(outputRoot, source, title);
  const tempDir = join(omnifetchCacheDir(), 'asr', jobId);

  const info: JobInfo = {
    job_id: jobId,
    input,
    title,
    source,
    output_dir: outputDir,
    started_at: new Date().toISOString(),
    status: 'running',
  };

  await mkdir(outputDir, { recursive: true });
  await writeJson(join(outputDir, 'job.json'), info);

  try {
    await mkdir(tempDir, { recursive: true });
    const sourceAudio = await prepareInput(input, tempDir);
    const chunks = await splitAudio(sourceAudio, tempDir, Number(flags['chunk-seconds'] || 600));
    if (chunks.length === 0) throw new Error('没有可识别的音频分块');

    const segments: SegmentTranscript[] = [];
    for (let i = 0; i < chunks.length; i++) {
      process.stderr.write(`ASR ${i + 1}/${chunks.length}: ${basename(chunks[i])}\n`);
      const text = await transcribeChunk(chunks[i], flags);
      segments.push({ index: i + 1, file: basename(chunks[i]), text: text.trim() });
      await writeJson(join(outputDir, 'job.json'), { ...info, status: 'running', finished_segments: segments.length, total_segments: chunks.length });
    }

    const rawTranscript = segments.map((s) => `## Segment ${s.index}\n\n${s.text}`).join('\n\n');
    const mergedText = segments.map((s) => s.text).filter(Boolean).join('\n\n');
    const { summary, terms, polished } = await makeDocuments(mergedText, segments, flags);

    await writeFile(join(outputDir, 'transcript.raw.md'), `# 原始转写\n\n${rawTranscript}\n`, 'utf8');
    await writeFile(join(outputDir, 'summary.md'), summary, 'utf8');
    await writeFile(join(outputDir, 'terms.md'), terms, 'utf8');
    await writeFile(join(outputDir, 'document.md'), polished, 'utf8');
    await writeJson(join(outputDir, 'manifest.json'), {
      job_id: jobId,
      input,
      title,
      source,
      generated_at: new Date().toISOString(),
      artifacts: ['summary.md', 'terms.md', 'transcript.raw.md', 'document.md', 'manifest.json', 'job.json'],
      chunks: chunks.length,
    });

    const done: JobInfo = { ...info, status: 'completed', finished_at: new Date().toISOString() };
    await writeJson(join(outputDir, 'job.json'), done);
    await rm(tempDir, { recursive: true, force: true });

    process.stdout.write(`完成: ${outputDir}\n\n${summary}\n`);
    return 0;
  } catch (e: any) {
    const failed: JobInfo = { ...info, status: 'failed', finished_at: new Date().toISOString(), error: e?.message || String(e) };
    await writeJson(join(outputDir, 'job.json'), failed);
    process.stderr.write(`✗ ASR 任务失败: ${failed.error}\n输出目录: ${outputDir}\n`);
    return 1;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function startBackground(input: string, flags: AsrFlags): number {
  const jobId = String(flags['job-id'] || makeJobId());
  const title = sanitize(String(flags.title || inferTitle(input))).slice(0, 120) || jobId;
  const source = sanitize(inferSource(input));
  const outputRoot = resolve(String(flags['output-root'] || 'output'));
  const outputDir = join(outputRoot, source, title);
  const logPath = join(outputDir, 'job.log');

  try {
    mkdirSync(outputDir, { recursive: true });
    const args = process.argv.slice(1).filter((arg) => arg !== '--background');
    args.push('--no-background', '--job-id', jobId);
    const logFd = openSync(logPath, 'a');
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: process.env,
    });
    child.unref();
    process.stdout.write(`后台 ASR 任务已启动\njob_id: ${jobId}\noutput_dir: ${outputDir}\nlog: ${logPath}\n`);
    return 0;
  } catch (e: any) {
    process.stderr.write(`✗ 后台任务启动失败: ${e.message}\n`);
    return 1;
  }
}

async function prepareInput(input: string, tempDir: string): Promise<string> {
  if (/^https?:\/\//i.test(input)) {
    const url = new URL(input);
    const ext = extname(url.pathname) || '.audio';
    const target = join(tempDir, `source${ext}`);
    const res = await fetch(input);
    if (!res.ok) throw new Error(`下载音频失败: HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    await writeFile(target, Buffer.from(ab));
    return target;
  }
  const file = resolve(input);
  const st = await stat(file);
  if (!st.isFile()) throw new Error(`不是文件: ${file}`);
  return file;
}

async function splitAudio(input: string, tempDir: string, chunkSeconds: number): Promise<string[]> {
  const chunkDir = join(tempDir, 'chunks');
  await mkdir(chunkDir, { recursive: true });
  const ffmpeg = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  if (ffmpeg.status !== 0) {
    const copy = join(chunkDir, `chunk-0000${extname(input) || '.audio'}`);
    await writeFile(copy, await readFile(input));
    return [copy];
  }

  const outPattern = join(chunkDir, 'chunk-%04d.m4a');
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'aac', '-b:a', '64k',
    '-f', 'segment', '-segment_time', String(Math.max(30, chunkSeconds || 600)),
    '-reset_timestamps', '1', outPattern,
  ];
  const p = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (p.status !== 0) throw new Error(`ffmpeg 分块失败: ${p.stderr || p.stdout}`);

  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(chunkDir))
    .filter((f) => f.startsWith('chunk-') && f.endsWith('.m4a'))
    .sort()
    .map((f) => join(chunkDir, f));
  return files;
}

async function transcribeChunk(file: string, flags: AsrFlags): Promise<string> {
  const mock = String(flags['mock-asr-text'] || process.env.OMNIFETCH_ASR_MOCK_TEXT || '');
  if (mock) return `${mock} (${basename(file)})`;

  const apiUrl = String(flags['asr-api-url'] || process.env.OMNIFETCH_ASR_API_URL || DEFAULT_ASR_URL);
  const model = String(flags['asr-model'] || process.env.OMNIFETCH_ASR_MODEL || DEFAULT_ASR_MODEL);
  const key = process.env.OMNIFETCH_ASR_API_KEY || process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!key) {
    throw new Error('缺少 ASR API key。请设置 OMNIFETCH_ASR_API_KEY（或 GROQ_API_KEY/OPENAI_API_KEY），或用 --mock-asr-text 做离线测试。');
  }

  const bytes = await readFile(file);
  const form = new FormData();
  form.append('file', new Blob([bytes]), basename(file));
  form.append('model', model);
  if (flags.language) form.append('language', String(flags.language));
  form.append('response_format', 'json');

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ASR API HTTP ${res.status}: ${text.slice(0, 500)}`);
  let data: any;
  try { data = JSON.parse(text); } catch { return text.trim(); }
  return String(data.text ?? data.transcript ?? data.transcription ?? data.result ?? '').trim();
}

async function makeDocuments(mergedText: string, segments: SegmentTranscript[], flags: AsrFlags): Promise<{ summary: string; terms: string; polished: string }> {
  const llmUrl = process.env.OMNIFETCH_LLM_API_URL;
  const llmKey = process.env.OMNIFETCH_LLM_API_KEY || process.env.OPENAI_API_KEY || '';
  if (llmUrl && llmKey) {
    try {
      const summary = await callChat(llmUrl, llmKey, '请用中文为下面音频转写生成简要总结、主题要点、待核对事项。', mergedText.slice(0, 50000));
      const terms = await callChat(llmUrl, llmKey, '请从下面转写中推测专有名词、人名、机构名、论文/产品名，并按“候选词 - 理由/上下文”列出。', mergedText.slice(0, 50000));
      const polishedParts: string[] = [];
      for (const batch of batchSegments(segments, 5)) {
        polishedParts.push(await callChat(llmUrl, llmKey, '请在不改变事实的前提下，把以下 ASR 分块润色成通顺的中文文档段落；保留关键英文术语。', batch.map((s) => s.text).join('\n\n')));
      }
      return {
        summary: `# 简要总结\n\n${summary}\n`,
        terms: `# 专有名词候选\n\n${terms}\n`,
        polished: `# 完整文档\n\n${polishedParts.join('\n\n')}`,
      };
    } catch (e: any) {
      process.stderr.write(`⚠ LLM 润色失败，回退到本地规则: ${e.message}\n`);
    }
  }

  const sentences = splitSentences(mergedText);
  const top = sentences.slice(0, 8).join('\n- ');
  const termList = guessTerms(mergedText).map((t) => `- ${t}`).join('\n') || '- 暂未识别出明显专有名词候选';
  const polished = segments.map((s) => `## ${s.index}\n\n${basicPolish(s.text)}`).join('\n\n');
  return {
    summary: `# 简要总结\n\n> 未配置 LLM，总结采用本地启发式生成。\n\n## 开头要点\n\n- ${top || '转写内容为空'}\n`,
    terms: `# 专有名词候选\n\n> 未配置 LLM，以下为基于大小写、数字、缩写和中英混排的启发式候选。\n\n${termList}\n`,
    polished: `# 完整文档\n\n> 未配置 LLM，以下为基础清洗后的分块合并文本。\n\n${polished}\n`,
  };
}

async function callChat(apiUrl: string, key: string, system: string, content: string): Promise<string> {
  const model = process.env.OMNIFETCH_LLM_MODEL || 'qwen/qwen3-32b';
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      temperature: 0.2,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LLM API HTTP ${res.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  return String(data.choices?.[0]?.message?.content ?? '').trim();
}

function batchSegments<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[。！？!?\.])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function basicPolish(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function guessTerms(text: string): string[] {
  const candidates = new Map<string, number>();
  const patterns = [
    /\b[A-Z][A-Za-z0-9]*(?:[- ][A-Z]?[A-Za-z0-9]+){0,4}\b/g,
    /\b[A-Z]{2,}\b/g,
    /[\u4e00-\u9fff]{2,12}(?:API|模型|算法|框架|平台|论文|系统|公司|大学|基金|网络|数据库|Agent|Memory|Skill|Harness)/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const term = m[0].trim();
      if (term.length < 2 || /^Segment$/.test(term)) continue;
      candidates.set(term, (candidates.get(term) || 0) + 1);
    }
  }
  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 80)
    .map(([term, count]) => count > 1 ? `${term} ×${count}` : term);
}

function inferTitle(input: string): string {
  try {
    const u = new URL(input);
    return basename(u.pathname) || u.hostname;
  } catch {
    return basename(input, extname(input));
  }
}

function inferSource(input: string): string {
  try {
    const u = new URL(input);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'local';
  }
}

function makeJobId(): string {
  return `asr-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;
}

function omnifetchCacheDir(): string {
  return process.env.OMNIFETCH_HOME
    ? join(process.env.OMNIFETCH_HOME, 'cache')
    : join(process.env.HOME || process.cwd(), '.omnifetch', 'cache');
}

async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export function currentModulePath(): string {
  return fileURLToPath(import.meta.url);
}

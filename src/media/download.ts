import { writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUA } from '../core/http.ts';
import { BILI_HEADERS } from '../platforms/bilibili/index.ts';
import type { MediaAsset, Platform } from '../core/types.ts';

export async function downloadMedia(assets: MediaAsset[], dir: string, platform: Platform): Promise<void> {
  mkdirSync(dir, { recursive: true });

  for (const asset of assets) {
    const outPath = join(dir, asset.filename);
    console.error(`  ↓ ${asset.filename} (${asset.type}${asset.quality ? ' ' + asset.quality : ''})`);

    const tryUrls = [asset.url, ...(asset.backupUrls ?? [])];
    let downloaded = false;

    for (const tryUrl of tryUrls) {
      try {
        const headers: Record<string, string> = { 'User-Agent': randomUA() };
        if (platform === 'bilibili') Object.assign(headers, BILI_HEADERS);
        else if (platform === 'rednote') headers.Referer = 'https://www.xiaohongshu.com/';
        else if (platform === 'pixiv') headers.Referer = 'https://www.pixiv.net/';

        const res = await fetch(tryUrl, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        let finalPath = outPath;
        if (asset.type === 'image') {
          const ct = res.headers.get('content-type') ?? '';
          const ext = ct.includes('png') ? '.png' : ct.includes('webp') ? '.webp' : '.jpg';
          finalPath = outPath.replace(/\.[^.]+$/, ext);
        }

        const buf = Buffer.from(await res.arrayBuffer());
        writeFileSync(finalPath, buf);
        console.error(`    ✓ ${(buf.length / 1024).toFixed(0)} KB → ${finalPath}`);
        downloaded = true;
        break;
      } catch (e: any) {
        console.error(`    ✗ 尝试失败: ${e.message}`);
      }
    }
    if (!downloaded) console.error('    ✗ 所有地址均失败，跳过');
  }

  if (platform === 'bilibili') {
    const videoFile = assets.find((a) => a.type === 'video' && a.filename.endsWith('.m4s'));
    const audioFile = assets.find((a) => a.type === 'audio' && a.filename.endsWith('.m4a'));
    if (videoFile && audioFile) {
      const videoPath = join(dir, videoFile.filename);
      const audioPath = join(dir, audioFile.filename);
      const baseName = videoFile.filename.replace('_video.m4s', '');
      const outputPath = join(dir, `${baseName}.mp4`);
      console.error(`  合并音视频 → ${outputPath}`);
      const merged = await ffmpegMerge(videoPath, audioPath, outputPath);
      if (merged) {
        try { unlinkSync(videoPath); } catch { /* ignore */ }
        try { unlinkSync(audioPath); } catch { /* ignore */ }
        console.error('  ✓ 合并完成');
      } else {
        console.error('  ⚠ ffmpeg 未安装，保留分离的音视频文件');
      }
    }
  }
}

function ffmpegMerge(video: string, audio: string, output: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-y', '-i', video, '-i', audio, '-c:v', 'copy', '-c:a', 'aac', output], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

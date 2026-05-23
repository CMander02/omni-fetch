/**
 * Per-user data directory for omnifetch.
 *
 * Everything we write that isn't the user's explicit output goes here:
 *   - cache/subs/<random>/   yt-dlp subtitle scratch dirs (auto-cleaned on success)
 *   - logs/                  reserved for future debug logs
 *
 * Resolves to `~/.omnifetch` on all platforms. We deliberately don't follow
 * the XDG / %LOCALAPPDATA% conventions — easy to find by name is more useful
 * than spec compliance for a personal CLI.
 */
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';

export function omnifetchHome(): string {
  return process.env.OMNIFETCH_HOME ?? join(homedir(), '.omnifetch');
}

export function cacheDir(): string {
  const dir = join(omnifetchHome(), 'cache');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a fresh scratch directory under ~/.omnifetch/cache/<bucket>/.
 * Caller is responsible for rm-ing it when done.
 */
export function makeScratchDir(bucket: string): string {
  const parent = join(cacheDir(), bucket);
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, ''));
}

/**
 * Delete every scratch dir we own — used by `of clean`.
 * Returns { dirs, files, bytes } removed.
 */
export function cleanScratch(): { dirs: number; files: number; bytes: number } {
  const home = omnifetchHome();
  let dirs = 0, files = 0, bytes = 0;
  const cache = join(home, 'cache');
  try { statSync(cache); } catch { return { dirs, files, bytes }; }

  for (const bucket of readdirSync(cache)) {
    const bp = join(cache, bucket);
    try {
      for (const entry of readdirSync(bp)) {
        const ep = join(bp, entry);
        const s = statSync(ep);
        if (s.isDirectory()) {
          // sum sizes recursively before deletion
          const summed = sumSizes(ep);
          files += summed.files;
          bytes += summed.bytes;
          dirs += 1;
          rmSync(ep, { recursive: true, force: true });
        } else {
          files += 1;
          bytes += s.size;
          rmSync(ep, { force: true });
        }
      }
    } catch { /* ignore */ }
  }
  // Also sweep legacy `omnifetch-subs-*` left in OS tmpdir by old versions.
  try {
    for (const entry of readdirSync(tmpdir())) {
      if (!entry.startsWith('omnifetch-subs-')) continue;
      const ep = join(tmpdir(), entry);
      try {
        const s = statSync(ep);
        if (s.isDirectory()) {
          const summed = sumSizes(ep);
          files += summed.files;
          bytes += summed.bytes;
          dirs += 1;
          rmSync(ep, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return { dirs, files, bytes };
}

function sumSizes(dir: string): { files: number; bytes: number } {
  let files = 0, bytes = 0;
  try {
    for (const entry of readdirSync(dir)) {
      const ep = join(dir, entry);
      const s = statSync(ep);
      if (s.isDirectory()) {
        const sub = sumSizes(ep);
        files += sub.files;
        bytes += sub.bytes;
      } else {
        files += 1;
        bytes += s.size;
      }
    }
  } catch { /* ignore */ }
  return { files, bytes };
}

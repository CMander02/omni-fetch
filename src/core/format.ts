// Routes through ~/.omnifetch/config.json. Defaults to UTC + compact
// (`YYYYMMDDTHHMMSSZ`). Users override via `of timezone set`.
//
// `fmtTs` / `fmtIsoCompact` / `nowIsoCompact` are intentionally kept as a
// stable contract (UTC compact, pure). Platform code that wants the active
// user setting calls `fmtUserTime` / `nowUserTime`.
import { loadConfig, renderTime, DEFAULT_CONFIG } from './time-config.ts';

/** Unix seconds → UTC compact `YYYYMMDDTHHMMSSZ`. '' for falsy input. */
export function fmtTs(ts: number): string {
  if (!ts) return '';
  return renderTime(new Date(ts * 1000), DEFAULT_CONFIG);
}

/** Accept ISO string / ms-since-epoch / Date → UTC compact. */
export function fmtIsoCompact(v: unknown): string {
  return renderTime(v, DEFAULT_CONFIG);
}

/** Wall-clock now in UTC compact. */
export function nowIsoCompact(): string {
  return renderTime(new Date(), DEFAULT_CONFIG);
}

/** User-configured equivalents — what platform code should use. */
export function fmtUserTime(v: unknown): string {
  return renderTime(v, loadConfig());
}

export function nowUserTime(): string {
  return renderTime(new Date(), loadConfig());
}

export function fmtDuration(s: number): string {
  if (!s) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtSize(bytes: number): string {
  if (!bytes) return '未知';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

export function sanitize(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80) || 'download';
}

export function yamlStr(s: string): string {
  if (!s) return '""';
  if (/[:#\[\]{}&*!|>'",\n\\]/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  return s;
}

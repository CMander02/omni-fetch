/**
 * Time formatting controlled by user settings.
 *
 * The same Date can render as:
 *   compact UTC          20260524T084500Z
 *   compact non-UTC      20260524T164500+0800
 *   loose no-offset      2026-05-24 16:45:00
 *   loose with offset    2026-05-24 16:45:00 +0800
 *
 * Defaults are UTC + compact + no offset.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { omnifetchHome } from './paths.ts';

export interface TimeConfig {
  timezone: string;       // IANA name, e.g. "UTC", "Asia/Shanghai"
  format: 'compact' | 'loose';
  showOffset: boolean;    // loose only — append "+0800"; ignored in compact UTC
}

export const DEFAULT_CONFIG: TimeConfig = {
  timezone: 'UTC',
  format: 'compact',
  showOffset: false,
};

export const TIMEZONE_PRESETS = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Kolkata',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/Los_Angeles',
  'America/New_York',
  'America/Chicago',
  'Australia/Sydney',
] as const;

function configPath(): string {
  return join(omnifetchHome(), 'config.json');
}

export function loadConfig(): TimeConfig {
  try {
    const text = readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(text);
    const time = parsed.time ?? {};
    return {
      timezone: typeof time.timezone === 'string' ? time.timezone : DEFAULT_CONFIG.timezone,
      format: time.format === 'loose' ? 'loose' : 'compact',
      showOffset: !!time.showOffset,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg: TimeConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  // Preserve any other config keys we might add later.
  let existing: any = {};
  if (existsSync(path)) {
    try { existing = JSON.parse(readFileSync(path, 'utf-8')); } catch { existing = {}; }
  }
  existing.time = cfg;
  writeFileSync(path, JSON.stringify(existing, null, 2) + '\n', 'utf-8');
}

/**
 * Pull date parts for a given IANA zone. Uses Intl.DateTimeFormat which knows
 * DST. Returns 4-digit year, padded month/day/hour/min/sec.
 */
function partsInZone(d: Date, timezone: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const out: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = p.value;
  }
  // Intl may produce '24' for midnight in some envs; normalize to '00'.
  if (out.hour === '24') out.hour = '00';
  return out as { year: string; month: string; day: string; hour: string; minute: string; second: string };
}

/**
 * Compute zone offset (in minutes east of UTC) at a given instant for a zone.
 */
function offsetMinutes(d: Date, timezone: string): number {
  if (timezone === 'UTC') return 0;
  const p = partsInZone(d, timezone);
  const asUtcMs = Date.UTC(
    +p.year, +p.month - 1, +p.day,
    +p.hour, +p.minute, +p.second,
  );
  return Math.round((asUtcMs - d.getTime()) / 60000);
}

function offsetString(minutes: number): string {
  const sign = minutes >= 0 ? '+' : '-';
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${sign}${hh}${mm}`;
}

function coerceDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    // Heuristic: 10-digit number is seconds-since-epoch, 13-digit is ms.
    const d = new Date(v < 1e12 ? v * 1000 : v);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function renderTime(input: unknown, cfg: TimeConfig): string {
  const d = coerceDate(input);
  if (!d) return '';
  const p = partsInZone(d, cfg.timezone);
  const off = offsetMinutes(d, cfg.timezone);

  if (cfg.format === 'compact') {
    // Compact always carries timezone info: 'Z' for UTC, '+HHMM' otherwise.
    const tail = off === 0 ? 'Z' : offsetString(off);
    return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}${tail}`;
  }
  // loose
  const base = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
  return cfg.showOffset ? `${base} ${offsetString(off)}` : base;
}

export function describeConfig(cfg: TimeConfig, now: Date = new Date()): string {
  const compactCfg: TimeConfig = { ...cfg, format: 'compact' };
  const looseCfg: TimeConfig = { ...cfg, format: 'loose' };
  return [
    `timezone:   ${cfg.timezone}`,
    `format:     ${cfg.format}${cfg.format === 'loose' && cfg.showOffset ? ' (with offset)' : ''}`,
    '',
    `compact:    ${renderTime(now, compactCfg)}`,
    `loose:      ${renderTime(now, { ...looseCfg, showOffset: false })}`,
    `loose+off:  ${renderTime(now, { ...looseCfg, showOffset: true })}`,
    '',
    `→ active:   ${renderTime(now, cfg)}`,
  ].join('\n');
}

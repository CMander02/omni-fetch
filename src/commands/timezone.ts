/**
 * `of timezone` subcommand: view + change time formatting settings.
 *
 *   of timezone                      view current settings + sample timestamps
 *   of timezone help                 help text
 *   of timezone set                  interactive picker (arrow-key)
 *   of timezone set <name>           set zone directly (must be IANA name)
 *   of timezone set --format compact|loose
 *   of timezone set --offset y|n
 */
import {
  loadConfig, saveConfig, describeConfig,
  TIMEZONE_PRESETS, type TimeConfig,
} from '../core/time-config.ts';
import { selectInteractive } from '../core/interactive-select.ts';

function timezoneHelp(): void {
  process.stdout.write(`
of timezone — 查看/修改 omnifetch 的时间格式设置

用法:
  of timezone                       显示当前设置 + 各格式示例
  of timezone help                  显示本帮助
  of timezone set                   交互式设置（上下箭头选时区/格式）
  of timezone set <IANA-name>       直接设置时区，如 Asia/Shanghai 或 UTC
  of timezone set --format compact  紧凑格式（默认）：20260524T084500Z
  of timezone set --format loose    松散格式：2026-05-24 08:45:00
  of timezone set --offset y        loose 格式下显示 +0800 后缀
  of timezone set --offset n        loose 格式下不显示后缀

预设时区:
${TIMEZONE_PRESETS.map(z => `  ${z}`).join('\n')}

配置文件: ~/.omnifetch/config.json
`);
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

async function pickTimezone(current: string): Promise<string | null> {
  const opts = TIMEZONE_PRESETS.map(z => ({
    label: z, value: z, hint: z === current ? '当前' : undefined,
  }));
  const initial = Math.max(0, TIMEZONE_PRESETS.indexOf(current as any));
  const picked = await selectInteractive('选择时区（↑↓ 移动，Enter 确认，Esc 取消）', opts, initial);
  return picked?.value ?? null;
}

async function pickFormat(current: TimeConfig['format']): Promise<TimeConfig['format'] | null> {
  const opts = [
    { label: 'compact', value: 'compact', hint: 'YYYYMMDDTHHMMSSZ' },
    { label: 'loose',   value: 'loose',   hint: 'YYYY-MM-DD HH:MM:SS' },
  ];
  const initial = current === 'loose' ? 1 : 0;
  const picked = await selectInteractive('选择格式（↑↓ 移动，Enter 确认，Esc 取消）', opts, initial);
  return (picked?.value as TimeConfig['format']) ?? null;
}

async function pickOffset(current: boolean): Promise<boolean | null> {
  const opts = [
    { label: '不显示偏移', value: 'n', hint: '2026-05-24 08:45:00' },
    { label: '显示偏移',   value: 'y', hint: '2026-05-24 08:45:00 +0800' },
  ];
  const picked = await selectInteractive('loose 格式下是否显示时区偏移？', opts, current ? 1 : 0);
  if (!picked) return null;
  return picked.value === 'y';
}

function parseYesNo(v: string): boolean | null {
  const s = v.toLowerCase();
  if (['y', 'yes', 'true', '1', 'on'].includes(s)) return true;
  if (['n', 'no', 'false', '0', 'off'].includes(s)) return false;
  return null;
}

/**
 * Handles `of timezone …`. `rest` is the positionals AFTER 'timezone' was
 * already shifted off by parseArgs. Flags like --format / --offset come
 * through the top-level flag bag.
 */
export async function timezoneCommand(
  rest: string[],
  flagFormat?: string,
  flagOffset?: string,
): Promise<number> {
  const cfg = loadConfig();
  const sub = (rest[0] ?? '').toLowerCase();

  if (!sub) {
    process.stdout.write(describeConfig(cfg) + '\n');
    return 0;
  }
  if (sub === 'help') {
    timezoneHelp();
    return 0;
  }
  if (sub === 'set') {
    return await handleSet(rest.slice(1), cfg, flagFormat, flagOffset);
  }
  process.stderr.write(`✗ 未知 timezone 子命令: ${sub}\n  用 \`of timezone help\` 查看用法\n`);
  return 1;
}

async function handleSet(
  positionals: string[],
  cfg: TimeConfig,
  flagFormat: string | undefined,
  flagOffset: string | undefined,
): Promise<number> {
  let zone: string | undefined = positionals.find(p => !p.startsWith('-'));
  let format: TimeConfig['format'] | undefined;
  let showOffset: boolean | undefined;

  if (flagFormat) {
    if (flagFormat !== 'compact' && flagFormat !== 'loose') {
      process.stderr.write(`✗ --format 只支持 compact 或 loose（收到: ${flagFormat}）\n`);
      return 1;
    }
    format = flagFormat;
  }
  if (flagOffset !== undefined) {
    const b = parseYesNo(flagOffset);
    if (b === null) {
      process.stderr.write(`✗ --offset 只支持 y/n（收到: ${flagOffset}）\n`);
      return 1;
    }
    showOffset = b;
  }

  // No args at all → fully interactive (zone → format → offset)
  const fullyInteractive = zone === undefined && format === undefined && showOffset === undefined;
  if (fullyInteractive) {
    const z = await pickTimezone(cfg.timezone);
    if (z === null) { process.stderr.write('已取消\n'); return 0; }
    zone = z;
    const f = await pickFormat(cfg.format);
    if (f === null) { process.stderr.write('已取消\n'); return 0; }
    format = f;
    if (format === 'loose') {
      const o = await pickOffset(cfg.showOffset);
      if (o === null) { process.stderr.write('已取消\n'); return 0; }
      showOffset = o;
    }
  } else if (zone && !isValidTimezone(zone)) {
    process.stderr.write(`✗ 无效的 IANA 时区名: ${zone}\n`);
    return 1;
  }

  const next: TimeConfig = {
    timezone: zone ?? cfg.timezone,
    format: format ?? cfg.format,
    showOffset: showOffset ?? cfg.showOffset,
  };
  saveConfig(next);
  process.stdout.write('✓ 已保存\n\n' + describeConfig(next) + '\n');
  return 0;
}

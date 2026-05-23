/**
 * Minimal interactive single-select for TTY. Use Up/Down arrows + Enter.
 * Returns the selected option, or null if cancelled (Ctrl+C / Esc).
 *
 * No deps; uses readline raw mode. Works on Windows ConEmu / Windows Terminal
 * and any POSIX terminal.
 */

export interface SelectOption {
  label: string;
  value: string;
  hint?: string;
}

const ESC = '\x1b';
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_LINE = `${ESC}[2K`;
const CLEAR_DOWN = `${ESC}[0J`;
const MOVE_UP = (n: number) => `${ESC}[${n}A`;
const COL0 = '\r';

function color(s: string, code: string): string {
  return `${ESC}[${code}m${s}${ESC}[0m`;
}

export async function selectInteractive(
  title: string,
  options: SelectOption[],
  initialIndex = 0,
): Promise<SelectOption | null> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('交互模式需要 TTY。请用 `<cmd> <name>` 形式直接传参。');
  }
  if (options.length === 0) return null;

  let index = Math.max(0, Math.min(initialIndex, options.length - 1));
  const stdout = process.stdout;
  const stdin = process.stdin;

  const render = (firstDraw: boolean) => {
    let out = '';
    if (!firstDraw) out += MOVE_UP(options.length + 1);
    out += COL0 + CLEAR_LINE + color(title, '1') + '\n';
    for (let i = 0; i < options.length; i++) {
      const o = options[i];
      const cursor = i === index ? color('>', '36') : ' ';
      const label = i === index ? color(o.label, '36;1') : o.label;
      const hint = o.hint ? color(`  (${o.hint})`, '2') : '';
      out += COL0 + CLEAR_LINE + `${cursor} ${label}${hint}\n`;
    }
    stdout.write(out);
  };

  stdout.write(HIDE_CURSOR);
  render(true);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise<SelectOption | null>((resolve) => {
    const cleanup = (result: SelectOption | null) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write(CLEAR_DOWN + SHOW_CURSOR);
      resolve(result);
    };

    const onData = (chunk: string) => {
      // Key sequences:
      //   '\x1b[A' up
      //   '\x1b[B' down
      //   '\r' or '\n' enter
      //   '\x03' Ctrl-C
      //   '\x1b' Esc
      if (chunk === '\x03' || chunk === '\x1b') {
        cleanup(null);
        return;
      }
      if (chunk === '\r' || chunk === '\n') {
        cleanup(options[index]);
        return;
      }
      if (chunk === '\x1b[A' || chunk === 'k') {
        index = (index - 1 + options.length) % options.length;
        render(false);
        return;
      }
      if (chunk === '\x1b[B' || chunk === 'j') {
        index = (index + 1) % options.length;
        render(false);
        return;
      }
      // number keys 1-9 for quick jump
      const n = parseInt(chunk, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= options.length) {
        index = n - 1;
        render(false);
      }
    };

    stdin.on('data', onData);
  });
}

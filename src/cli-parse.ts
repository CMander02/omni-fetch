export interface ParsedArgs {
  flags: Record<string, string | boolean>;
  url: string;
  /** Remaining positionals after a subcommand consumed the first. */
  rest: string[];
}

// Flags that always consume the next argv as their value.
const VALUE_FLAGS = new Set(['out', 'media-dir', 'quality', 'mode', 'sub-langs', 'type', 'with-media', 'out-dir', 'format', 'offset']);

// Flags that *optionally* consume the next argv: if it looks like a value
// (doesn't start with - and isn't a URL/id), take it; otherwise leave it as
// a boolean.
const OPTIONAL_VALUE_FLAGS = new Set(['export']);

const SHORT_FLAGS: Record<string, string> = {
  h: 'help',
  v: 'version',
  e: 'export',
};

// Positional subcommands. Each maps the positional to a flag.
const SUBCOMMANDS: Record<string, string> = {
  help: 'help',
  platforms: 'platforms',
  list: 'platforms',
  version: 'version',
  detect: 'detect',
  clean: 'clean',
  timezone: 'timezone',
  tz: 'timezone',
};

const URL_RE = /https?:\/\/[^\s　<>"'】）)]+/i;
const BV_RE = /\bBV[a-zA-Z0-9]{10}\b/;

function looksLikeFlagValue(s: string | undefined): boolean {
  // Returns true if `s` is something we should attach to a flag rather than
  // treat as a positional URL.
  if (s === undefined) return false;
  if (s.startsWith('-')) return false;
  if (URL_RE.test(s)) return false;
  if (BV_RE.test(s)) return false;
  // Bare arxiv id
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s)) return false;
  return true;
}

function extractUrl(text: string): string | null {
  const m = text.match(URL_RE);
  if (m) return m[0].replace(/[.,;!?。，；！？]+$/, '');
  const bv = text.match(BV_RE);
  if (bv) return bv[0];
  return null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (VALUE_FLAGS.has(name)) {
        flags[name] = args[++i] ?? '';
      } else if (OPTIONAL_VALUE_FLAGS.has(name)) {
        const next = args[i + 1];
        if (looksLikeFlagValue(next)) {
          flags[name] = next!;
          i++;
        } else {
          flags[name] = true;
        }
      } else {
        flags[name] = true;
      }
      continue;
    }
    if (a.startsWith('-') && a.length === 2) {
      const name = SHORT_FLAGS[a.slice(1)];
      if (name) {
        if (OPTIONAL_VALUE_FLAGS.has(name)) {
          const next = args[i + 1];
          if (looksLikeFlagValue(next)) {
            flags[name] = next!;
            i++;
          } else {
            flags[name] = true;
          }
        } else {
          flags[name] = true;
        }
        continue;
      }
    }
    positionals.push(a);
  }

  // Subcommand handling: first positional may be a verb (`help`, `platforms`, …)
  const first = positionals[0]?.toLowerCase();
  if (first && SUBCOMMANDS[first]) {
    flags[SUBCOMMANDS[first]] = true;
    positionals.shift();
  }

  // Find the first URL across remaining positionals
  for (const p of positionals) {
    const found = extractUrl(p);
    if (found) return { flags, url: found, rest: positionals };
  }

  // Fall back to first remaining positional (detect.ts handles non-URL ids)
  return { flags, url: positionals[0] ?? '', rest: positionals };
}

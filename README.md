# omnifetch

Unified content fetcher — paste any link, get content. Supports WeChat / Xiaoyuzhou / Bilibili / Xiaohongshu / Zhihu, with a yt-dlp fallback for everything else (YouTube / Twitter / Vimeo / 1000+ sites).

## Install

```bash
# global install (publishes the of / omnifetch commands)
npm install -g omnifetch

# or for local development
git clone <repo> && cd omni-fetch
npm install
npm run build
npm link
```

Optional but recommended for video subtitles and the generic fallback:

```bash
uv tool install yt-dlp
# or: pipx install yt-dlp / brew install yt-dlp / winget install yt-dlp.yt-dlp
```

## Usage

```bash
# Minimal — paste a link, get Markdown on stdout
of https://mp.weixin.qq.com/s/Xvoh9hGnqe7rJ_ns5tRwBQ

# Full structured payload as JSON
of https://www.bilibili.com/video/BV1GJ411x7h7 --json

# Save to file
of BV1GJ411x7h7 --out video.md

# Download media along with metadata
of BV1GJ411x7h7 --media --quality 720p

# Generic article fallback channels
of "https://example.com/article" --article-mode jina
of "https://example.com/article" --article-mode playwright --mode headless
of "https://example.com/article" --article-mode html

# YouTube via yt-dlp fallback
of "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Skip subtitle fetching (default is on for videos)
of BV1GJ411x7h7 --no-subs

# Audio transcription can be triggered as a flag on a file/URL
of ./episode.m4a --transcribe --background --title "episode-notes"
```

### Audio ASR workflow

Long audio transcription is available as a dedicated subcommand. It splits audio into temporary chunks, sends them to a configurable OpenAI-compatible ASR endpoint one by one, merges transcripts, generates a short summary and terminology candidates, optionally uses an OpenAI-compatible chat endpoint for batch polishing, then writes final artifacts under `output/<source>/<task-title>/` while removing intermediate chunks.

```bash
# Foreground run; best for short audio
of ./episode.m4a --transcribe --title "episode-notes"
of asr ./episode.m4a --title "episode-notes"      # compatibility alias

# Background run; recommended for long audio in agent/scheduler contexts
of ./episode.m4a --transcribe --background --title "episode-notes"
of asr ./episode.m4a --background --title "episode-notes"

# URL input also works when the URL directly points to an audio file
of "https://example.com/audio.mp3" --transcribe --background
of transcribe "https://example.com/audio.mp3" --background  # compatibility alias
```

ASR defaults to Groq's OpenAI-compatible transcription endpoint, but all endpoint/model choices are configurable:

```bash
export OMNIFETCH_ASR_API_URL=https://api.groq.com/openai/v1/audio/transcriptions
export OMNIFETCH_ASR_API_KEY=...
export OMNIFETCH_ASR_MODEL=whisper-large-v3-turbo

# Optional LLM polishing / summary. Without this, omnifetch uses local heuristics.
export OMNIFETCH_LLM_API_URL=https://api.openai.com/v1/chat/completions
export OMNIFETCH_LLM_API_KEY=...
export OMNIFETCH_LLM_MODEL=qwen/qwen3-32b
```

Final output folder contains only products, not chunk intermediates:

```text
output/<source>/<task-title>/
├── document.md        # polished / cleaned full document
├── summary.md         # concise summary
├── terms.md           # guessed proper nouns and technical terms
├── transcript.raw.md  # merged raw ASR transcript
├── manifest.json
├── job.json
└── job.log            # only for background jobs
```

### Options

| Flag | Effect |
|------|--------|
| `--json` | Output JSON (default: Markdown with YAML frontmatter) |
| `--markdown` | Explicit Markdown (same as default) |
| `--out <file>` | Save to file instead of stdout |
| `--media` | Download images / video / audio |
| `--media-dir <dir>` | Media output dir (default `./media/<title>`) |
| `--quality <q>` | Video quality: `360p` / `480p` / `720p` / `1080p` |
| `--mode <m>` | Browser mode for CDP/browser platforms: `gui` reuses logged-in Chrome via CDP; `headless` launches Playwright Chromium without login |
| `--article-mode <m>` | Generic article channel: `auto` (default), `defuddle`, `jina`, `playwright`, `html`, or `yt-dlp` |
| `--transcribe` | Treat the input file/direct-audio URL as an ASR task (`of <audio> --transcribe`) |
| `--no-subs` | Skip subtitle fetching |
| `--sub-langs <l>` | Comma-separated subtitle langs (default `zh,zh-CN,zh-Hans,en`) |
| `--background` | For `of asr`: run the audio ASR workflow detached and return job/output paths immediately |
| `--title <title>` | For `of asr`: task title and output subdirectory name |
| `--output-root <dir>` | For `of asr`: output root, default `./output` |
| `--chunk-seconds <sec>` | For `of asr`: audio chunk length, default 600 seconds |
| `--asr-api-url <url>` | For `of asr`: override OpenAI-compatible ASR endpoint |
| `--asr-model <model>` | For `of asr`: override ASR model |
| `--language <lang>` | For `of asr`: pass language hint to ASR endpoint |

## Platforms

- **WeChat (mp.weixin.qq.com)** — server-rendered, no auth needed.
- **Xiaoyuzhou (xiaoyuzhoufm.com)** — podcasts & episodes via `__NEXT_DATA__`.
- **Apple Podcasts (podcasts.apple.com)** — episode or show pages; uses the public iTunes Lookup API. Returns full description, m4a audio URL, RSS feed, and 600px artwork. No auth needed. Platform key: `apple-podcasts`.
- **Bilibili** — WBI-signed API; default `--quality 360p` for no-login reliability, higher qualities may require login or may fail; official Bilibili AI video summaries are fetched from `/x/web-interface/view/conclusion/get` when a logged-in cookie is available (`OMNIFETCH_BILIBILI_COOKIE`, `BILIBILI_COOKIE`, `BILI_COOKIE`, `SESSDATA`, or `~/.config/omnifetch/bilibili-cookie`). JSON includes the raw `ai_summary` plus a normalized top-level `outline` (`summary`, segment `time_kv`, detail `detail_kv`, `segments`, `details`); Markdown includes the AI summary and timestamped timeline by default. Subtitles via yt-dlp.
- **Rednote (Xiaohongshu)** — note pages require `xsec_token`; image-original URL rewriting; videos call yt-dlp for subs. Author profile URLs (`/user/profile/<uid>`) return username/user id/signature/counts and the homepage post list when present in `__INITIAL_STATE__`. Platform key: `rednote`.
- **Zhihu zhuanlan / answer** — Playwright browser extraction. Default `--mode gui` reuses your logged-in Chrome via CDP; `--mode headless` launches Playwright Chromium without login and only works for content visible to anonymous users.
- **X (Twitter)** — `x.com/<user>` returns the profile + recent tweets; `x.com/<user>/status/<id>` returns the tweet, expanding to the full thread when the same author keeps replying to themselves. Playwright over CDP; reuses your Chrome login.
- **Hacker News (news.ycombinator.com)** — item & user pages via Firebase API. Item pages include up to 50 comments breadth-first.
- **Pixiv (pixiv.net)** — artwork / user / novel pages via the internal `/ajax/...` endpoints, executed inside the user's logged-in Chrome (CDP). Original-resolution image URLs (`i.pximg.net`) come along; `--media` downloads them with the required `Referer: https://www.pixiv.net/` header. R-18 / follower-only works require the user be logged in. Platform key: `pixiv`.
- **Reddit (reddit.com / redd.it)** — posts, subreddits, users via the public `.json` API. Note: requires an unproxied connection to `reddit.com`; if `curl` works but `of` doesn't, your shell environment likely has a TLS/DNS interceptor that node's `fetch` can't bypass.
- **Generic article fallback** — for any other URL, [defuddle](https://github.com/kepano/defuddle) extracts the readable article (title, author, body, cover). Works on most blogs, news sites, and Lofter/Substack-style hosted content.
- **Generic video fallback** — if defuddle finds no article, yt-dlp tries the URL (YouTube/Vimeo/1000+ sites).

### Browser reuse (Chrome CDP)

`zhihu`, `x`, and `pixiv` can drive your existing Chrome via the DevTools Protocol — no separate profile, no extra login. This is the default `--mode gui`. Once per session, start Chrome with the remote-debugging port open:

```bash
# Windows
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

Make sure you are logged into the target sites in that Chrome window. Then run `of <url>` as normal — `of` opens a new tab inside your browser, scrapes, and closes the tab. Override the port via `OMNIFETCH_CDP_PORT`.

## Development

```bash
npm install
npm test          # node:test, all offline
npm run build     # tsc → dist/
npm run dev <url> # tsx src/cli.ts
```

Source layout:

```
src/
├── cli.ts              # entry point
├── cli-parse.ts        # argv parser
├── detect.ts           # URL → platform
├── core/
│   ├── types.ts
│   ├── http.ts
│   ├── html.ts         # HTML → Markdown
│   ├── format.ts       # fmt helpers
│   ├── render.ts       # toMarkdown / toJSON
│   └── ytdlp.ts        # yt-dlp wrapper + SRT parsing
├── platforms/
│   ├── wechat.ts
│   ├── xiaoyuzhou.ts
│   ├── bilibili.ts
│   ├── xhs.ts
│   ├── zhihu.ts
│   └── ytdlp-generic.ts
└── media/
    └── download.ts     # downloader + ffmpeg merge
```

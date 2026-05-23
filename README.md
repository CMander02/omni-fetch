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

# YouTube via yt-dlp fallback
of "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Skip subtitle fetching (default is on for videos)
of BV1GJ411x7h7 --no-subs
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
| `--mode <m>` | Zhihu Playwright mode: `gui` / `headless` |
| `--no-subs` | Skip subtitle fetching |
| `--sub-langs <l>` | Comma-separated subtitle langs (default `zh,zh-CN,zh-Hans,en`) |

## Platforms

- **WeChat (mp.weixin.qq.com)** — server-rendered, no auth needed.
- **Xiaoyuzhou (xiaoyuzhoufm.com)** — podcasts & episodes via `__NEXT_DATA__`.
- **Apple Podcasts (podcasts.apple.com)** — episode or show pages; uses the public iTunes Lookup API. Returns full description, m4a audio URL, RSS feed, and 600px artwork. No auth needed. Platform key: `apple-podcasts`.
- **Bilibili** — WBI-signed API, up to 720P without login; subtitles via yt-dlp.
- **Rednote (Xiaohongshu)** — `xsec_token` required; image-original URL rewriting; videos call yt-dlp for subs. Platform key: `rednote`.
- **Zhihu zhuanlan / answer** — Playwright over CDP; reuses your Chrome login.
- **X (Twitter)** — `x.com/<user>` returns the profile + recent tweets; `x.com/<user>/status/<id>` returns the tweet, expanding to the full thread when the same author keeps replying to themselves. Playwright over CDP; reuses your Chrome login.
- **Hacker News (news.ycombinator.com)** — item & user pages via Firebase API. Item pages include up to 50 comments breadth-first.
- **Pixiv (pixiv.net)** — artwork / user / novel pages via the internal `/ajax/...` endpoints, executed inside the user's logged-in Chrome (CDP). Original-resolution image URLs (`i.pximg.net`) come along; `--media` downloads them with the required `Referer: https://www.pixiv.net/` header. R-18 / follower-only works require the user be logged in. Platform key: `pixiv`.
- **Reddit (reddit.com / redd.it)** — posts, subreddits, users via the public `.json` API. Note: requires an unproxied connection to `reddit.com`; if `curl` works but `of` doesn't, your shell environment likely has a TLS/DNS interceptor that node's `fetch` can't bypass.
- **Generic article fallback** — for any other URL, [defuddle](https://github.com/kepano/defuddle) extracts the readable article (title, author, body, cover). Works on most blogs, news sites, and Lofter/Substack-style hosted content.
- **Generic video fallback** — if defuddle finds no article, yt-dlp tries the URL (YouTube/Vimeo/1000+ sites).

### Browser reuse (Chrome CDP)

`zhihu` and `x` drive your existing Chrome via the DevTools Protocol — no separate profile, no extra login. Once per session, start Chrome with the remote-debugging port open:

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

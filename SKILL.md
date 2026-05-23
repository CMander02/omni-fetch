---
name: omni-fetch
description: |
  统一内容抓取工具，CLI 名为 `of` 或 `omnifetch`，npm 全局安装。
  支持五个平台 + yt-dlp 通用 fallback：
  - 微信公众号  mp.weixin.qq.com/s/...
  - 小宇宙播客  xiaoyuzhoufm.com/podcast/... 或 /episode/...
  - Apple 播客  podcasts.apple.com/<country>/podcast/<slug>/idXXX[?i=YYY]
  - B 站视频    bilibili.com/video/BV... 或直接输入 BVxxxxxx
  - 小红书 (rednote)  xiaohongshu.com/...?xsec_token=... 或 xhslink.com/...
  - 知乎专栏    zhuanlan.zhihu.com/p/... 或 zhihu.com/question/.../answer/...（Playwright，需先登录）
  - X (Twitter) x.com/<user> 用户页 或 x.com/<user>/status/<id> 帖子/thread（Playwright，需先 x-login）
  - 其他 URL    → yt-dlp（YouTube / Vimeo / 1000+ 站点）

  触发场景：
  (1) 用户粘贴任意以上平台链接，要求抓取/保存/导出内容
  (2) 用户说"帮我抓取这个"、"下载这个视频/音频/图片"、"保存这篇文章"
  (3) 用户明确说 omni-fetch、of、omnifetch、"万能抓取"
  (4) 用户给一个 YouTube/Twitter 等链接要文本/字幕

  最简用法：of <url> —— 自动识别平台，markdown 输出。
allowed-tools:
  - Bash
  - Write
---

# omni-fetch / of —— 统一内容抓取

## 调用

CLI 已通过 `npm link` 或 `npm install -g omnifetch` 全局安装，命令为 `of` 或 `omnifetch`。

```bash
# 最简：自动识别 + Markdown 到 stdout
of "<url>"

# 保存到文件
of "<url>" --out article.md

# 结构化 JSON（含完整 meta + body_markdown + media）
of "<url>" --json

# 下载媒体
of "<url>" --media --media-dir ~/Downloads/xhs/

# 指定 B 站视频画质
of "<url>" --media --quality 720p

# 视频默认抓字幕（yt-dlp）；--no-subs 关闭
of "<url>" --no-subs

# 知乎用 headless
of "https://zhuanlan.zhihu.com/p/xxx" --mode headless
```

## 选项

| 选项 | 说明 |
|------|------|
| `--json` | JSON 全套主要信息（默认 Markdown） |
| `--markdown` | 显式 Markdown（与默认相同） |
| `--out <file>` | 保存到文件（默认 stdout） |
| `--media` | 同时下载媒体 |
| `--media-dir <dir>` | 媒体目录（默认 `./media/<标题>`） |
| `--quality <画质>` | `360p` \| `480p` \| `720p` \| `1080p` |
| `--mode <模式>` | 知乎: `gui` \| `headless` |
| `--no-subs` | 关闭视频字幕抓取 |
| `--sub-langs <langs>` | 字幕语言，逗号分隔（默认 `zh,zh-CN,zh-Hans,en`） |

## 前置依赖

- Node.js >= 20，已 `npm install -g omnifetch` 或在源码目录 `npm link`
- 视频字幕功能需要 yt-dlp：`uv tool install yt-dlp`
- **知乎 / X** 走 CDP 复用本地 Chrome —— 提前用 `chrome --remote-debugging-port=9222` 启动 Chrome 并保持已登录状态；`of` 会在你的浏览器里开一个新 tab 抓取后自动关闭。可用 `OMNIFETCH_CDP_PORT` 改端口（默认 9222）

## 工作流程

1. 从用户消息提取 URL（含 xhslink 短链）
2. 直接 `of <url>` 输出（默认 Markdown）
3. 用户需要结构化数据加 `--json`
4. 用户需要本地保存加 `--out path`
5. 用户需要原始媒体加 `--media`

## 示例

```bash
of "https://mp.weixin.qq.com/s/Xvoh9hGnqe7rJ_ns5tRwBQ" --out ~/Notes/wechat.md
of "https://www.bilibili.com/video/BV1GJ411x7h7" --media --quality 480p
of "https://www.xiaohongshu.com/discovery/item/xxx?xsec_token=xxx" --media
of "https://www.xiaoyuzhoufm.com/episode/xxx" --media --out ep.md
of "https://zhuanlan.zhihu.com/p/xxx" --json --out article.json
of "https://www.youtube.com/watch?v=xxx" --json   # yt-dlp 通用 fallback
```

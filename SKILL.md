---
name: omni-fetch
description: |
  统一内容抓取工具，支持五个平台，自动识别 URL：
  - 微信公众号  mp.weixin.qq.com/s/...
  - 小宇宙播客  xiaoyuzhoufm.com/podcast/... 或 /episode/...
  - B 站视频    bilibili.com/video/BV... 或直接输入 BVxxxxxx
  - 小红书      xiaohongshu.com/...?xsec_token=... 或 xhslink.com/...
  - 知乎专栏    zhuanlan.zhihu.com/p/...（Playwright，需先登录）

  触发场景：
  (1) 用户粘贴以上任意平台链接，要求抓取/保存/导出内容
  (2) 用户说"帮我抓取这个"、"下载这个视频/音频/图片"、"保存这篇文章"
  (3) 需要同时抓取多个平台内容时
  (4) 用户明确说 omni-fetch 或"万能抓取"

  优先级：若用户只需单一平台，可继续使用对应专属 skill；
  若涉及多平台或用户直接扔链接，用此 skill。

  工具位置：C:/zychen/AIGC/Agent/Skills/web/omni-fetch/fetch.ts
allowed-tools:
  - Bash
  - Write
---

# omni-fetch — 统一内容抓取

自动识别平台，抓取文字内容（Obsidian Markdown 或 JSON），可选下载媒体文件。

## 工具位置

```
C:/zychen/AIGC/Agent/Skills/web/omni-fetch/
├── fetch.ts        # 单文件，含全部平台逻辑
└── package.json    # 依赖（tsx, typescript；playwright 可选）
```

## 用法

```bash
cd C:/zychen/AIGC/Agent/Skills/web/omni-fetch

# 抓取文字内容（Markdown 输出到 stdout）
npx tsx fetch.ts "<url>"

# 保存 Markdown 到文件
npx tsx fetch.ts "<url>" --out article.md

# 输出 JSON
npx tsx fetch.ts "<url>" --json

# 下载媒体（图片/视频/音频），保存到 ./media/<标题>/
npx tsx fetch.ts "<url>" --media

# 指定媒体目录
npx tsx fetch.ts "<url>" --media --media-dir ~/Downloads/xhs/

# 指定视频画质（B站、小红书）
npx tsx fetch.ts "<url>" --media --quality 720p

# 知乎（Playwright，默认 gui 模式）
npx tsx fetch.ts "https://zhuanlan.zhihu.com/p/xxx" --mode headless
```

## 选项

| 选项 | 说明 |
|------|------|
| `--json` | 输出原始 JSON（默认 Obsidian Markdown） |
| `--out <file>` | 保存到文件（默认 stdout） |
| `--media` | 同时下载媒体文件 |
| `--media-dir <dir>` | 媒体保存目录（默认 `./media/<标题>`） |
| `--quality <画质>` | 视频画质：`360p`\|`480p`\|`720p`\|`1080p`（默认 `360p`） |
| `--mode <模式>` | 知乎 Playwright 模式：`gui`\|`headless`（默认 `gui`） |

## 平台说明

### 微信公众号
- 无需浏览器，服务端渲染直接解析
- 提取：标题、作者、公众号、发布时间、正文、封面

### 小宇宙播客
- 支持频道页（podcast）和单集页（episode）
- 媒体：封面图 + 音频文件（.m4a）

### B 站
- 无需登录，最高 720P（qn=64）
- 优先 DASH（配套音视频，ffmpeg 合并）；回退 FLV/MP4 单文件
- 画质默认 360P；`--quality 720p` 可提升

### 小红书
- 支持图文帖和视频帖
- 支持 `/explore/`、`/discovery/item/` 路径
- **xsec_token 有时效**，使用新鲜的分享链接（几小时内）
- 图片转换为原图 URL（ci.xiaohongshu.com）

### 知乎专栏
- 依赖 Playwright + 已保存的登录 session
- Session 目录：`C:/zychen/AIGC/Agent/skill-dev/zhihu-fetch/zhihu_profile/`
- 首次使用需先运行：`npx tsx ../zhihu-fetch/auth.ts login`

## 工作流程

1. 从用户消息中提取 URL
2. 自动识别平台
3. 按需添加 `--media`、`--out`、`--quality` 等参数
4. 执行命令，展示标题、平台、媒体数量
5. 若保存到文件，告知路径

## 示例

```bash
# 微信文章保存为 Markdown
npx tsx fetch.ts "https://mp.weixin.qq.com/s/Xvoh9hGnqe7rJ_ns5tRwBQ" --out ~/Notes/wechat.md

# B站视频元数据 + 下载 480P
npx tsx fetch.ts "https://www.bilibili.com/video/BV1GJ411x7h7" --media --quality 480p

# 小红书视频下载
npx tsx fetch.ts "https://www.xiaohongshu.com/discovery/item/xxx?xsec_token=xxx" --media

# 小宇宙单集下载音频
npx tsx fetch.ts "https://www.xiaoyuzhoufm.com/episode/xxx" --media --out ep.md

# 知乎文章导出 JSON
npx tsx fetch.ts "https://zhuanlan.zhihu.com/p/xxx" --json --out article.json
```

# omni-fetch

统一抓取微信公众号 / 小宇宙 / B站 / 小红书 / 知乎，自动识别平台，支持 JSON / Markdown 输出和媒体下载。

## 开发

```bash
npm install
npx tsx fetch.ts <url>
```

主入口为 `fetch.ts`；`SKILL.md` 是 Claude Code skill 入口文件。

## 部署到 Claude Code

发版时将本目录同步到 `C:/zychen/AIGC/Agent/Skills/web/omni-fetch/`，并把 `SKILL.md` 拷贝为 `Skills/web/omni-fetch.md`。

或者将 `~/.claude/skills/omni-fetch` 软链到本目录，开发即生效。

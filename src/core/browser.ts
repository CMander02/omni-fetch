/**
 * Reuse the user's existing Chrome via CDP.
 *
 * Start Chrome once with `--remote-debugging-port=9222`, then this module
 * connects to it and reuses the logged-in cookies/sessions for all browser-
 * driven platforms (X, Zhihu, …).
 *
 * No persistent profile copying, no separate login flow.
 */

const DEFAULT_PORT = Number(process.env.OMNIFETCH_CDP_PORT ?? '9222');
const DEFAULT_HOST = process.env.OMNIFETCH_CDP_HOST ?? '127.0.0.1';

export function cdpEndpoint(port = DEFAULT_PORT, host = DEFAULT_HOST): string {
  return `http://${host}:${port}`;
}

export function cdpInstallHint(): string {
  return [
    '✗ 未能连接到本地 Chrome 的远程调试端口 (CDP)',
    '  请先启动 Chrome 时加 --remote-debugging-port=9222，例如：',
    '    Windows: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222',
    '    macOS:   /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222',
    '    Linux:   google-chrome --remote-debugging-port=9222',
    '  然后正常登录目标站点（X / 知乎 ...），再回来跑 of。',
    `  默认端口 9222，可用 OMNIFETCH_CDP_PORT 改。`,
  ].join('\n');
}

export interface BrowserPage {
  page: any;            // playwright.Page
  closeContext: () => Promise<void>; // closes the page only — never the user's browser
}

/**
 * Connect to the user's running Chrome via CDP and open a new tab in their
 * default context. The user's cookies/login are reused. We close only the tab
 * we opened.
 */
export async function openPage(targetUrl: string, mode: 'gui' | 'headless' = 'gui'): Promise<BrowserPage> {
  let chromium: any;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('需要 Playwright。请运行: npm install playwright');
  }

  if (mode === 'headless') {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return {
      page,
      closeContext: async () => {
        try { await context.close(); } catch { /* ignore */ }
        try { await browser.close(); } catch { /* ignore */ }
      },
    };
  }

  let browser: any;
  try {
    browser = await chromium.connectOverCDP(cdpEndpoint());
  } catch (e: any) {
    throw new Error(`${cdpInstallHint()}\n  原因: ${e.message}`);
  }

  // First context contains the user's existing tabs with their login.
  const contexts = browser.contexts();
  const context = contexts[0] ?? await browser.newContext();
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  return {
    page,
    closeContext: async () => {
      try { await page.close(); } catch { /* ignore */ }
      try { await browser.close(); } catch { /* ignore — disconnect, not kill */ }
    },
  };
}

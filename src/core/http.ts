const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
];

export function randomUA(): string {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}

export async function httpGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': randomUA(),
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      ...headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.text();
}

export async function httpGetBuffer(
  url: string,
  headers: Record<string, string> = {}
): Promise<{ buf: Buffer; contentType: string }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': randomUA(), ...headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return {
    buf: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') ?? '',
  };
}

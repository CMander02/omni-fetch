export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

export function htmlToMarkdown(html: string): string {
  if (!html) return '';
  let md = html;
  md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
  md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
  md = md.replace(/<!--[\s\S]*?-->/g, '');
  md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi,
    (_, c) => '```\n' + decodeEntities(stripTags(c)) + '\n```\n');
  for (let i = 1; i <= 6; i++) {
    md = md.replace(new RegExp(`<h${i}[^>]*>([\\s\\S]*?)<\\/h${i}>`, 'gi'),
      (_, t) => `\n${'#'.repeat(i)} ${stripTags(t).trim()}\n`);
  }
  md = md.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, (_, t) => `**${stripTags(t)}**`);
  md = md.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, (_, t) => `**${stripTags(t)}**`);
  md = md.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, (_, t) => `*${stripTags(t)}*`);
  md = md.replace(/<i[^>]*>([\s\S]*?)<\/i>/gi, (_, t) => `*${stripTags(t)}*`);
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${stripTags(t)}\``);
  md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    const t = stripTags(text).trim();
    return t ? `[${t}](${href})` : href;
  });
  md = md.replace(/<img\b([^>]*)\/?>/gi, (_, attrs: string) => {
    const dataSrc = attrs.match(/\bdata-src="([^"]*)"/i)?.[1];
    const src = attrs.match(/\bsrc="([^"]*)"/i)?.[1];
    const alt = attrs.match(/\balt="([^"]*)"/i)?.[1] ?? '';
    const finalSrc = dataSrc || src;
    return finalSrc ? `\n![${alt}](${finalSrc})\n` : '';
  });
  md = md.replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<\/p>/gi, '\n\n');
  md = md.replace(/<p[^>]*>/gi, '');
  md = md.replace(/<\/div>/gi, '\n');
  md = md.replace(/<div[^>]*>/gi, '');
  md = md.replace(/<\/section>/gi, '\n');
  md = md.replace(/<section[^>]*>/gi, '');
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
    (_, t) => stripTags(t).trim().split('\n').map((l: string) => `> ${l}`).join('\n') + '\n\n');
  md = md.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi,
    (_, c) => c.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, item: string) => `- ${stripTags(item).trim()}\n`));
  md = md.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, c) => {
    let i = 0;
    return c.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m: string, item: string) => `${++i}. ${stripTags(item).trim()}\n`);
  });
  md = md.replace(/<hr\s*\/?>/gi, '\n---\n');
  md = stripTags(md);
  md = decodeEntities(md);
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

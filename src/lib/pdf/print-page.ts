/**
 * The PDF is printed from a page the server drew from its own data (0043), never from HTML a browser sends. These pick
 * that page apart: its body without any script or inline handler, the site's own stylesheets, and its images.
 */
export function pageBody(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return (m ? m[1] : "")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<(noscript|template)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** Stylesheets linked from the page that the site itself serves (a path, never another host). */
export function sameOriginStyles(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel=["']?stylesheet/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href && href.startsWith("/") && !href.startsWith("//")) out.push(href);
  }
  return out;
}

export function imageSources(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]);
}

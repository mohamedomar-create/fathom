"use client";

/** Collect the page's CSS (minus @font-face, which the server embeds) so the PDF matches the screen exactly. */
function collectCss(): string {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of Array.from(rules)) if (!(r instanceof CSSFontFaceRule)) out.push(r.cssText);
  }
  return out.join("\n");
}

async function toDataUrl(src: string): Promise<string | null> {
  try {
    const res = await fetch(src, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.onerror = () => ok(null); fr.readAsDataURL(blob); });
  } catch { return null; }
}

export async function downloadReportPdf(opts: { title: string; footer?: string; token?: string; demo?: boolean }): Promise<void> {
  const el = document.getElementById("report");
  if (!el) throw new Error("Report not found on the page");
  const clone = el.cloneNode(true) as HTMLElement;
  for (const img of Array.from(clone.querySelectorAll("img"))) {
    if (img.src.startsWith("data:")) continue;
    const d = await toDataUrl(img.src);
    if (d) img.src = d; else img.remove();
  }
  const res = await fetch("/api/pdf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ html: clone.outerHTML, css: collectCss(), title: opts.title, footer: opts.footer, token: opts.token, demo: opts.demo }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error ?? `PDF export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${opts.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "report"}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

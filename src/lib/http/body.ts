/**
 * A request's JSON body, read with a hard cap: the declared length is checked first, then the bytes are counted as they
 * arrive, so a chunked body (no length header) can't get past it. Nothing over the cap is parsed.
 */
export async function readJsonCapped(req: Request, max: number): Promise<{ ok: true; value: unknown } | { ok: false; reason: "too_large" | "invalid" }> {
  if (Number(req.headers.get("content-length") ?? 0) > max) return { ok: false, reason: "too_large" };
  if (!req.body) return { ok: false, reason: "invalid" };
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel().catch(() => {}); return { ok: false, reason: "too_large" }; }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
  try { return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) }; } catch { return { ok: false, reason: "invalid" }; }
}

"use client";
import { AlertTriangle, CheckCircle2, FileText, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cleanNum } from "@/lib/ingest/parse";
import { pdfChecks, pdfGrids, recheckList, type PdfFlag, type PdfPage } from "@/lib/ingest/pdf";
import { MAX_PDF_PAGES, openFile, type OpenedFile } from "@/lib/ingest/pdf-client";
import type { PageRead } from "@/lib/ingest/pdf-schema";
import type { Grid } from "@/lib/ingest/extract";
import { cn } from "@/lib/cn";

export interface PdfSummary { pages: number; corrected: number; flagged: number }

const KIND: Record<PageRead["kind"], string> = { pl: "Profit and loss", bs: "Balance sheet", tb: "Trial balance", gl: "General ledger", sales: "Sales", other: "No table" };
const key = (file: string, n: number) => `${file}|${n}`;
const shown = (v: number | null | undefined) => (v === null || v === undefined ? "" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/** Sends one page to be read. Retries once when the connection or the service fails; a refusal (limit, access) is final. */
async function readOne(companyId: string, blob: Blob, check: string[] = []): Promise<PageRead> {
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append("page", blob, blob.type === "application/pdf" ? "page.pdf" : "page.jpg");
    if (check.length) form.append("check", JSON.stringify(check));
    let res: Response | null = null;
    try { res = await fetch(`/api/companies/${companyId}/read-page`, { method: "POST", body: form }); } catch { /* network: retry */ }
    const body = res ? await res.json().catch(() => ({})) as { read?: PageRead; error?: string } : {};
    if (res?.ok && body.read) return body.read;
    if (attempt >= 1 || (res && res.status < 500 && res.status !== 502 && res.status !== 504)) throw new Error(body.error ?? (res ? `The page could not be read (${res.status}).` : "Could not reach iReport. Check the connection and try again."));
  }
}

/** Runs tasks two at a time. */
async function pool<T>(items: T[], run: (x: T) => Promise<void>, size = 2) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (i < items.length) await run(items[i++]); }));
}

export function PdfRead({ companyId, files, onDone, onCancel }: { companyId: string; files: File[]; onDone: (grids: Grid[], summary: PdfSummary) => void; onCancel: () => void }) {
  const [opened, setOpened] = useState<OpenedFile[] | null>(null);
  const [range, setRange] = useState<Record<string, [number, number]>>({});
  const [phase, setPhase] = useState<"open" | "plan" | "read" | "review">("open");
  const [pages, setPages] = useState<PdfPage[]>([]);
  const [done, setDone] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const started = useRef(false);

  useEffect(() => {
    let live = true;
    Promise.all(files.map(openFile)).then((os) => {
      if (!live) return;
      setOpened(os);
      setRange(Object.fromEntries(os.map((o) => [o.name, [1, Math.min(o.pages, MAX_PDF_PAGES)] as [number, number]])));
      const total = os.reduce((a, o) => a + o.pages, 0);
      setPhase(total > 10 ? "plan" : "read");
    }).catch((e: Error) => live && setErr(e.message || "The PDF could not be opened."));
    return () => { live = false; };
  }, [files]);

  const chosen = useMemo(() => (opened ?? []).flatMap((o) => {
    const [a, b] = range[o.name] ?? [1, o.pages];
    return Array.from({ length: Math.max(0, Math.min(b, o.pages) - Math.max(1, a) + 1) }, (_, i) => ({ o, n: Math.max(1, a) + i }));
  }), [opened, range]);

  useEffect(() => {
    if (phase !== "read" || started.current || !opened) return;
    if (chosen.length > MAX_PDF_PAGES) { setPhase("plan"); return; }
    started.current = true;
    const out: PdfPage[] = chosen.map(({ o, n }) => ({ file: o.name, n, read: null }));
    setPages(out.map((p) => ({ ...p })));
    const put = (p: PdfPage) => setPages((ps) => ps.map((x) => (x.file === p.file && x.n === p.n ? p : x)));
    (async () => {
      const blobs = new Map<string, Promise<Blob>>();
      const blobOf = (o: OpenedFile, n: number) => { const k = key(o.name, n); if (!blobs.has(k)) blobs.set(k, o.page(n)); return blobs.get(k)!; };
      await pool(chosen, async ({ o, n }) => {
        const i = out.findIndex((p) => p.file === o.name && p.n === n);
        try { out[i] = { ...out[i], read: await readOne(companyId, await blobOf(o, n)), error: undefined }; }
        catch (e) { out[i] = { ...out[i], error: (e as Error).message }; }
        put(out[i]); setDone((d) => d + 1);
      });
      // A table that does not add up is read once more, naming the rows to look at again; the better reading is kept.
      const flags = pdfChecks(out);
      const again = out.filter((p) => p.read && recheckList(p, flags).length);
      await pool(again, async (p) => {
        const o = opened.find((x) => x.name === p.file)!;
        const i = out.indexOf(p);
        try {
          const read = await readOne(companyId, await blobOf(o, p.n), recheckList(p, flags));
          const trial = out.map((x, j) => (j === i ? { ...x, read } : x));
          const count = (ps: PdfPage[]) => pdfChecks(ps).filter((f) => f.file === p.file && f.page === p.n && f.kind !== "unclear").length;
          out[i] = { ...p, rereads: 1, ...(count(trial) <= count(out) ? { read } : {}) };
        } catch { out[i] = { ...p, rereads: 1 }; }
        put(out[i]);
      });
      setPages([...out]);
      setPhase("review");
    })();
  }, [phase, chosen, opened, companyId]);

  async function retry(p: PdfPage) {
    const o = opened?.find((x) => x.name === p.file);
    if (!o) return;
    setPages((ps) => ps.map((x) => (x === p ? { ...x, error: undefined } : x)));
    try { const read = await readOne(companyId, await o.page(p.n)); setPages((ps) => ps.map((x) => (x.file === p.file && x.n === p.n ? { ...x, read, error: undefined, v: (x.v ?? 0) + 1 } : x))); }
    catch (e) { setPages((ps) => ps.map((x) => (x.file === p.file && x.n === p.n ? { ...x, error: (e as Error).message } : x))); }
  }

  const flags = useMemo(() => pdfChecks(pages), [pages]);
  const edit = (p: PdfPage, row: number, change: (r: PageRead["rows"][number]) => PageRead["rows"][number]) => {
    setPages((ps) => ps.map((x) => (x === p && x.read ? { ...x, read: { ...x.read, rows: x.read.rows.map((r, i) => (i === row ? change(r) : r)) } } : x)));
    setEdited((s) => new Set(s).add(`${p.file}|${p.n}|${row}`));
  };

  if (err) return (
    <div className="rounded-lg border border-line p-6" data-testid="pdf-error">
      <p className="rounded bg-red-bg px-3 py-2 text-sm text-red" role="alert">{err}</p>
      <button onClick={onCancel} className="mt-4 text-sm text-mute underline">Choose other files</button>
    </div>
  );

  if (phase === "open" || !opened) return <div className="flex items-center gap-3 rounded-lg border border-line p-6 text-sm"><Loader2 className="h-5 w-5 animate-spin text-brand" />Opening {files.map((f) => f.name).join(", ")}…</div>;

  if (phase === "plan") {
    const n = chosen.length;
    return (
      <div className="space-y-4 rounded-lg border border-line p-5" data-testid="pdf-plan">
        <h2 className="text-lg font-medium">Which pages hold the figures?</h2>
        <p className="text-sm text-mute">Each page is read separately (about EGP 2–3 a page). Leave out covers, notes and auditor letters. Up to {MAX_PDF_PAGES} pages at a time.</p>
        {opened.map((o) => (
          <div key={o.name} className="flex flex-wrap items-center gap-2 text-sm">
            <FileText className="h-4 w-4 text-brand-d" /><span className="font-medium">{o.name}</span><span className="text-mute">({o.pages} pages) · pages</span>
            {[0, 1].map((j) => (
              <input key={j} type="number" min={1} max={o.pages} value={range[o.name]?.[j] ?? 1} aria-label={j ? "Last page" : "First page"} data-testid={j ? "pdf-to" : "pdf-from"}
                onChange={(e) => setRange((r) => { const v = [...(r[o.name] ?? [1, o.pages])] as [number, number]; v[j] = Math.max(1, Math.min(o.pages, Number(e.target.value) || 1)); return { ...r, [o.name]: v }; })}
                className="w-16 rounded border border-line px-2 py-1" />
            ))}
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
          <button onClick={onCancel} className="mr-auto text-sm text-mute underline">Cancel</button>
          {n > MAX_PDF_PAGES && <span className="text-sm text-red">Choose up to {MAX_PDF_PAGES} pages ({n} chosen).</span>}
          <button disabled={!n || n > MAX_PDF_PAGES} onClick={() => setPhase("read")} className="rounded bg-brand-d px-5 py-2.5 font-medium text-white disabled:opacity-50" data-testid="pdf-start">Read {n} page{n === 1 ? "" : "s"}</button>
        </div>
      </div>
    );
  }

  if (phase === "read") {
    const total = chosen.length;
    return (
      <div className="rounded-lg border border-line p-6" data-testid="pdf-reading">
        <div className="flex items-center gap-3"><Loader2 className="h-5 w-5 animate-spin text-brand" /><span>{done < total ? `Reading page ${Math.min(done + 1, total)} of ${total}…` : "Checking that the figures add up…"}</span></div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-band"><div className="h-full bg-brand transition-all" style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} /></div>
        <p className="mt-3 text-xs text-mute">Pages are sent to Claude (Anthropic) to be read and are not kept by iReport. Nothing is imported until you check the figures.</p>
      </div>
    );
  }

  const tables = pages.filter((p) => p.read && p.read.kind !== "other" && p.read.rows.length);
  const failed = pages.filter((p) => p.error);
  const toCheck = flags.length;
  const grids = pdfGrids(pages);
  return (
    <div className="space-y-5" data-testid="pdf-review">
      <div>
        <h2 className="text-lg font-medium">Check what was read</h2>
        <p className="text-sm text-mute">Compare each table with its page and correct any figure before continuing. Rows that do not add up, or that could not be read with certainty, are highlighted.</p>
      </div>
      <div className="flex flex-wrap gap-2 text-[13px]">
        <span className="rounded bg-band px-3 py-1.5">{tables.length} of {pages.length} page{pages.length === 1 ? "" : "s"} with figures</span>
        {toCheck ? <span className="flex items-center gap-1.5 rounded bg-amber/15 px-3 py-1.5" data-testid="pdf-flag-count"><AlertTriangle className="h-4 w-4 text-[#9a6b00]" />{toCheck} row{toCheck === 1 ? "" : "s"} to check</span>
          : <span className="flex items-center gap-1.5 rounded bg-green-bg px-3 py-1.5 text-green-d" data-testid="pdf-all-add-up"><CheckCircle2 className="h-4 w-4" />Every total adds up</span>}
        {failed.length > 0 && <span className="rounded bg-red-bg px-3 py-1.5 text-red">{failed.length} page{failed.length === 1 ? "" : "s"} could not be read</span>}
      </div>
      {pages.map((p) => <PageReview key={key(p.file, p.n)} page={p} file={opened.find((o) => o.name === p.file)} flags={flags.filter((f) => f.file === p.file && f.page === p.n)} onEdit={edit} onRetry={() => retry(p)} />)}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
        <button onClick={onCancel} className="mr-auto text-sm text-mute underline">Cancel</button>
        {!grids.length && <span className="text-sm text-red">No table of figures was found on these pages.</span>}
        <button disabled={!grids.length} onClick={() => onDone(grids, { pages: pages.length, corrected: edited.size, flagged: toCheck })} className="rounded bg-brand-d px-5 py-2.5 font-medium text-white disabled:opacity-50" data-testid="pdf-use">
          {toCheck ? "Continue with these figures" : "Use these figures"}
        </button>
      </div>
    </div>
  );
}

function PageReview({ page, file, flags, onEdit, onRetry }: { page: PdfPage; file?: OpenedFile; flags: PdfFlag[]; onEdit: (p: PdfPage, row: number, f: (r: PageRead["rows"][number]) => PageRead["rows"][number]) => void; onRetry: () => void }) {
  const [img, setImg] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Pictures are drawn when the page scrolls into view, so a long PDF does not stall the browser.
  useEffect(() => {
    if (!file || !box.current) return;
    let url: string | null = null, live = true;
    const io = new IntersectionObserver((es) => {
      if (!es.some((e) => e.isIntersecting)) return;
      io.disconnect();
      file.preview(page.n, 900).then((u) => { url = u; if (live) setImg(u); }).catch((e) => { console.error("page picture failed", e); if (live) setImg("failed"); });
    }, { rootMargin: "400px" });
    io.observe(box.current);
    return () => { live = false; io.disconnect(); if (url) URL.revokeObjectURL(url); };
  }, [file, page.n]);
  const r = page.read;
  const byRow = new Map<number, PdfFlag[]>();
  for (const f of flags) byRow.set(f.row, [...(byRow.get(f.row) ?? []), f]);
  return (
    <section ref={box} className="rounded-lg border border-line" data-testid="pdf-page">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 text-sm">
        <FileText className="h-4 w-4 text-brand-d" />
        <span className="font-medium">{page.file} · page {page.n}</span>
        {r && <span className="text-mute">{KIND[r.kind]}{r.title ? ` · ${r.title}` : ""}{r.scale !== "units" ? ` · in ${r.scale}` : ""}{r.currency ? ` · ${r.currency}` : ""}</span>}
        {page.rereads ? <span className="text-xs text-mute">(read twice to check its totals)</span> : null}
      </header>
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="max-h-[70vh] overflow-auto rounded bg-band">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local picture of the page (blob URL) */}
          {img ? <img src={img} alt={`Page ${page.n} of ${page.file}`} className="w-full" /> : <div className="flex h-40 items-center justify-center text-xs text-mute">Drawing the page…</div>}
        </div>
        <div className="max-h-[70vh] overflow-auto">
          {page.error ? (
            <div className="space-y-2 text-sm"><p className="rounded bg-red-bg px-3 py-2 text-red" role="alert">{page.error}</p><button onClick={onRetry} className="flex items-center gap-1.5 text-brand-d underline"><RotateCcw className="h-3.5 w-3.5" />Try this page again</button></div>
          ) : !r ? <Loader2 className="h-5 w-5 animate-spin text-brand" />
            : r.kind === "other" || !r.rows.length ? <p className="text-sm text-mute">No table of figures on this page; it is left out.</p>
            : (
              <table key={page.v ?? 0} className="tbl text-[12px]">
                <thead className="sticky top-0 bg-white"><tr><th>Line</th>{r.columns.map((c, i) => <th key={i} className="text-right">{c}</th>)}</tr></thead>
                <tbody>
                  {r.rows.map((row, i) => {
                    const fl = byRow.get(i) ?? [];
                    const bad = fl.some((f) => f.kind !== "unclear");
                    return (
                      <tr key={i} className={cn(bad ? "bg-red-bg" : fl.length ? "bg-amber/15" : "", row.total && "font-medium")} data-testid={fl.length ? "pdf-flagged-row" : undefined} title={fl.map((f) => f.text).join("\n") || undefined}>
                        <td className={cn(row.heading && "label pt-3")}>
                          {row.code && <span className="mr-1 text-mute">{row.code}</span>}{row.label}
                          {fl.map((f) => <div key={f.text} className={cn("text-[11px]", bad ? "text-red" : "text-[#9a6b00]")}>{f.text}</div>)}
                          {row.unclear && <button onClick={() => onEdit(page, i, (x) => ({ ...x, unclear: false }))} className="text-[11px] text-brand-d underline">Figures are right</button>}
                        </td>
                        {!row.heading && r.columns.map((_, c) => (
                          <td key={c} className="text-right">
                            <input defaultValue={shown(row.values[c])} aria-label={`${row.label} ${r.columns[c]}`}
                              onBlur={(e) => {
                                const t = e.target.value.trim(), v = t === "" ? null : cleanNum(t);
                                if (t !== "" && v === null) { e.target.value = shown(row.values[c]); return; }
                                if (v !== (row.values[c] ?? null)) onEdit(page, i, (x) => ({ ...x, unclear: false, values: r.columns.map((__, k) => (k === c ? v : x.values[k] ?? null)) }));
                              }}
                              className="num w-28 rounded border border-transparent bg-transparent px-1 py-0.5 text-right hover:border-line focus:border-brand" />
                          </td>
                        ))}
                        {row.heading && <td colSpan={r.columns.length} />}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </section>
  );
}

"use client";
import { Download, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { APP_NAME } from "@/lib/brand";
import { ReportDocument } from "@/components/report/report-document";
import { downloadReportPdf } from "@/lib/report/export";
import type { ReportInput } from "@/lib/report/types";
import { UnreadModules } from "@/components/shell/module-state";

export function PublicReport({ input, token }: { input: ReportInput; token: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="min-h-screen bg-[#ecece8] print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center gap-3 bg-bar px-4 py-2 text-sm text-white">
        <span className="font-semibold">{input.companyName}</span><span className="text-[#aaa]">{input.title}</span>
        <div className="ms-auto flex gap-2">
          <button onClick={async () => { setBusy(true); setErr(null); try { await downloadReportPdf({ title: `${input.companyName} - ${input.title}`, token, footer: input.org.footer ?? `${input.companyName} - Prepared by ${input.org.name}` }); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }}
            className="flex items-center gap-1.5 rounded bg-brand-d px-3 py-1.5">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}PDF</button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded bg-bar-2 px-3 py-1.5"><Printer className="h-4 w-4" />Print</button>
        </div>
      </div>
      {err && <p className="no-print mx-auto mt-3 max-w-xl rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      {input.periodGone && <p role="alert" className="mx-auto mt-3 max-w-xl rounded bg-amber/15 px-3 py-2 text-sm" data-testid="report-period-gone">This period is no longer in the books: the company changed its figures after this link was shared. Ask them for an updated link.</p>}
      {!!input.unread?.length && <p role="status" className="no-print mx-auto mt-3 max-w-xl rounded border border-amber/60 bg-amber/10 px-3 py-2 text-sm" data-testid="report-unread">{input.unread.map((m) => (m === "sales" ? "Sales" : "Expense")).join(" and ")} detail couldn&apos;t be loaded just now, so those parts are marked below. Reload the page to try again.</p>}
      <UnreadModules modules={input.unread ?? []}><div className="py-6 print:p-0"><ReportDocument input={input} /></div></UnreadModules>
      <footer className="no-print pb-6 text-center text-xs text-mute">
        Shared with {APP_NAME} · <Link href="/privacy" className="hover:text-ink">Privacy</Link> · <Link href="/terms" className="hover:text-ink">Terms</Link>
      </footer>
    </div>
  );
}

"use client";
import { Download, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { APP_NAME } from "@/lib/brand";
import { ReportDocument, titleIn } from "@/components/report/report-document";
import { useT } from "@/lib/i18n/use-t";
import { useMsg } from "@/lib/i18n/msg";
import { downloadReportPdf } from "@/lib/report/export";
import type { ReportInput } from "@/lib/report/types";
import { UnreadModules } from "@/components/shell/module-state";

export function PublicReport({ input, token }: { input: ReportInput; token: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const T = useT();
  const t = T.d.rep.pub;
  const m = useMsg();
  const title = titleIn(input.title, T);
  return (
    <div className="min-h-screen bg-[#ecece8] print:bg-white">
      <div className="no-print sticky top-0 z-10 flex items-center gap-3 bg-bar px-4 py-2 text-sm text-white">
        <span className="font-semibold">{input.companyName}</span><span className="text-[#aaa]">{title}</span>
        <div className="ms-auto flex gap-2">
          <button onClick={async () => { setBusy(true); setErr(null); try { await downloadReportPdf({ title: `${input.companyName} - ${title}`, token, footer: input.org.footer ?? t.footer(input.companyName, input.org.name) }); } catch (e) { setErr(m((e as Error).message)); } finally { setBusy(false); } }}
            className="flex items-center gap-1.5 rounded bg-brand-d px-3 py-1.5">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}PDF</button>
          <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded bg-bar-2 px-3 py-1.5"><Printer className="h-4 w-4" />{t.print}</button>
        </div>
      </div>
      {err && <p className="no-print mx-auto mt-3 max-w-xl rounded bg-red-bg px-3 py-2 text-sm text-red">{err}</p>}
      {input.periodGone && <p role="alert" className="mx-auto mt-3 max-w-xl rounded bg-amber/15 px-3 py-2 text-sm" data-testid="report-period-gone">{t.gone}</p>}
      {!!input.unread?.length && <p role="status" className="no-print mx-auto mt-3 max-w-xl rounded border border-amber/60 bg-amber/10 px-3 py-2 text-sm" data-testid="report-unread">{t.unread(input.unread.map((x) => (x === "sales" ? t.sales : t.expense)).join(t.and))}</p>}
      <UnreadModules modules={input.unread ?? []}><div className="py-6 print:p-0"><ReportDocument input={input} /></div></UnreadModules>
      <footer className="no-print pb-6 text-center text-xs text-mute">
        {t.shared(APP_NAME)} · <Link href="/privacy" className="hover:text-ink">{t.privacy}</Link> · <Link href="/terms" className="hover:text-ink">{t.terms}</Link>
      </footer>
    </div>
  );
}

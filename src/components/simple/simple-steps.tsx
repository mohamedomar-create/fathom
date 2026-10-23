"use client";
import Link from "next/link";
import { CheckCircle2, CircleDashed, Download } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { simpleSteps, type SimpleStatus } from "@/lib/company/data-steps";
import { cn } from "@/lib/cn";
import { templateHref } from "@/components/setup/readiness-view";

/**
 * Simple mode's Data steps: the company settings, then the Sales and Expenses sheets in any order, each with its blank
 * template. Same look as the Full sequence, without the ERP steps.
 */
export function SimpleDataSteps({ status }: { status: Omit<SimpleStatus, "basePath"> }) {
  const c = useCompany();
  const steps = simpleSteps({ ...status, basePath: c.basePath });
  const template: Record<string, string> = { sales: templateHref("simple-sales", c), expenses: templateHref("simple-expenses", c) };
  return (
    <div data-testid="simple-steps">
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.id} className="rounded-lg border border-line p-4" data-testid={`step-${s.id}`} data-status={s.status}>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#e8e8e4] text-xs font-semibold text-mute">{s.n}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{s.title}</h2>
                  {s.status === "done" ? <CheckCircle2 className="h-5 w-5 text-green-d" /> : <CircleDashed className="h-5 w-5 text-mute" />}
                  <span className="text-xs text-mute">{s.status === "done" ? "Done" : "To do"}</span>
                </div>
                <p className="mt-0.5 text-[15px] text-mute" data-testid={`step-${s.id}-detail`}>{s.detail}</p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {s.action && !c.readOnly && <Link prefetch={false} href={s.action.href} className={cn("rounded px-4 py-2 text-sm", s.status === "todo" ? "bg-brand-d text-white" : "border border-brand-d text-brand-d")} data-testid={`step-${s.id}-go`}>{s.action.label}</Link>}
                  {template[s.id] && <a href={template[s.id]} className="inline-flex items-center gap-1 text-sm text-brand-d underline" data-testid={`template-${s.id}`}><Download className="h-3.5 w-3.5" />Blank template</a>}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-6 max-w-3xl text-[13px] text-mute">Simple mode reads only your Sales and Expenses sheets. Everything you load is kept if you switch to Full mode later.</p>
    </div>
  );
}

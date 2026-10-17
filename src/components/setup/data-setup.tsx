"use client";
import Link from "next/link";
import { CheckCircle2, CircleDashed, AlertTriangle } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { mlabel, type ExpensesData, type SalesData } from "@/lib/engine";
import { useInventoryData } from "@/lib/company/inventory-context";
import type { InventoryState } from "@/lib/company/inventory-wire";
import type { ItemStatus, SectorReadiness } from "@/lib/company/readiness";
import { SectorPanel, TemplateButton, useReadiness } from "./readiness-view";
import { DataMap } from "./data-map";
import { cn } from "@/lib/cn";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function worst(...ss: ItemStatus[]): ItemStatus {
  return ss.includes("missing") ? (ss.every((s) => s === "missing") ? "missing" : "partial") : ss.includes("partial") ? "partial" : "done";
}
const sectorStatus = (r: SectorReadiness | undefined): ItemStatus => (!r ? "missing" : worst(...r.items.map((i) => i.status)));

/**
 * The guided way in: each step says what to provide, why, and how (an Odoo export or iReport's template),
 * with its status from the data already loaded. Below, every sector's readiness radar.
 */
export function DataSetup({ sales, expenses = null, inventory: state = null }: { sales: SalesData | null; expenses?: ExpensesData | null; inventory?: InventoryState | null }) {
  const parsed = useInventoryData(state);
  const inventory = state ? parsed : null;
  const c = useCompany();
  const all = useReadiness(sales, expenses, inventory);
  const by = (k: SectorReadiness["key"]) => all.find((r) => r.key === k);
  const fin = by("financials");
  const upload = (step: string) => `${c.basePath}/settings/source-data?step=${step}`;
  const steps: { n: number; title: string; status: ItemStatus; why: string; how?: React.ReactNode; actions: React.ReactNode; testId: string }[] = [
    {
      n: 1, title: "Company details", status: "done", testId: "step-profile",
      why: `${c.settings.currency} · year starts in ${MONTHS[c.settings.fyStartMonth - 1]} · tax ${(c.settings.taxRate * 100).toFixed(1)}%.`,
      actions: <Link href={`${c.basePath}/settings/profile`} className="text-sm text-brand-d underline">Check</Link>,
    },
    {
      n: 2, title: "Your accounts", status: sectorStatus(fin), testId: "step-financials",
      why: "Profit and loss, and balance sheet, month by month.",
      how: <>From Odoo: Accounting → Reporting → General Ledger → this year → tick Initial balance → Export. Or fill our template.</>,
      actions: <><Link href={upload("financials")} className="rounded bg-brand-d px-4 py-2 text-sm text-white" data-testid="upload-financials">Upload</Link><TemplateButton kind="financials" compact /></>,
    },
    {
      n: 3, title: "Proof files (optional)", status: "done", testId: "step-proof",
      why: "A Trial Balance double-checks your numbers.",
      how: <>From Odoo: Accounting → Reporting → Trial Balance, same dates → Export. Upload it with your accounts.</>,
      actions: <Link href={upload("financials")} className="text-sm text-brand-d underline">Upload</Link>,
    },
    {
      n: 4, title: "Your sales", status: sectorStatus(by("sales")), testId: "step-sales",
      why: "Who bought what, and when.",
      how: <>From Odoo: Invoicing → Reporting → Invoice Analysis → list view → Export. Or fill our template.</>,
      actions: <><Link href={upload("sales")} className="rounded bg-brand-d px-4 py-2 text-sm text-white" data-testid="upload-sales">Upload</Link><TemplateButton kind="sales" compact /></>,
    },
    {
      n: 5, title: "Your expenses", status: sectorStatus(by("expenses")), testId: "step-expenses",
      why: "Who you pay, and for what. It's in your General Ledger.",
      how: <>Uploaded your General Ledger? Then it&apos;s done. For more detail, add your vendor bills (Accounting → Reporting → Invoice Analysis → Vendor Bills → Export), or fill our template.</>,
      actions: <><Link href={upload("expenses")} className="rounded bg-brand-d px-4 py-2 text-sm text-white" data-testid="upload-expenses">Upload</Link><TemplateButton kind="expenses" compact /></>,
    },
    {
      n: 6, title: "Your stock (optional)", status: sectorStatus(by("inventory")), testId: "step-inventory",
      why: "Stock value, movements and what sits unsold, checked against your accounts.",
      how: <>From Odoo: Inventory → Reporting → Valuation, Moves History and Stock → list view → tick the top box and click “Select all N records” → Export, with “I want to update data (import-compatible export)” ticked and the ID field added (never External ID). Upload one or all three together.</>,
      actions: <Link href={upload("inventory")} className="rounded bg-brand-d px-4 py-2 text-sm text-white" data-testid="upload-inventory">Upload</Link>,
    },
    {
      n: 7, title: "Bank details", status: sectorStatus(by("banking")), testId: "step-banking",
      why: "Your loans, your rate, and what you want to borrow.",
      actions: <Link href={`${c.basePath}/banking`} className="rounded bg-brand-d px-4 py-2 text-sm text-white">Open</Link>,
    },
    {
      n: 8, title: "Forecast settings", status: sectorStatus(by("forecast")), testId: "step-forecast",
      why: "Check the numbers we guessed, then press Save.",
      actions: <Link href={`${c.basePath}/analysis/forecast`} className="rounded bg-brand-d px-4 py-2 text-sm text-white">Open</Link>,
    },
    {
      n: 9, title: "Your targets", status: c.settings.targets && Object.keys(c.settings.targets).length ? "done" : "partial", testId: "step-targets",
      why: "Pick 3 to 5 goals, like sales or profit.",
      actions: <Link href={`${c.basePath}/settings/targets`} className="text-sm text-brand-d underline">Set</Link>,
    },
  ];
  const latest = [...c.months].map((m) => m.period).sort().pop();
  return (
    <div data-testid="data-setup">
      <div className="label">1 · Data setup</div>
      <h1 className="mb-1 text-3xl font-light">Set up your data</h1>
      <p className="mb-6 text-mute">Do the steps in order.{latest ? ` Latest month: ${mlabel(latest)}.` : ""}</p>
      <ol className="mb-10 space-y-3">
        {steps.map((s) => (
          <li key={s.n} className="rounded-lg border border-line p-4" data-testid={s.testId} data-status={s.status}>
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", s.status === "done" ? "bg-green-bg text-green-d" : s.status === "partial" ? "bg-amber/20 text-[#9a6b00]" : "bg-red-bg text-red")}>{s.n}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{s.title}</h2>
                  {s.status === "done" ? <CheckCircle2 className="h-4 w-4 text-green-d" /> : s.status === "partial" ? <AlertTriangle className="h-4 w-4 text-[#9a6b00]" /> : <CircleDashed className="h-4 w-4 text-red" />}
                  <span className="text-xs text-mute">{s.status === "done" ? "Done" : s.status === "partial" ? "Partly done" : "To do"}</span>
                </div>
                <p className="mt-0.5 text-[15px] text-mute">{s.why}</p>
                {s.how && <details className="mt-1 text-sm"><summary className="cursor-pointer text-brand-d">How?</summary><p className="mt-1">{s.how}</p></details>}
                <div className="mt-3 flex flex-wrap items-center gap-2">{s.actions}</div>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <DataMap months={c.months} sales={sales} expenses={expenses} />
      <h2 className="mb-1 text-xl font-light">How ready is your data?</h2>
      <p className="mb-4 text-sm text-mute">Teal: what you have. Orange: how much of it checks out.</p>
      <div className="space-y-5">{all.map((r) => <SectorPanel key={r.key} r={r} basePath={c.basePath} />)}</div>
    </div>
  );
}

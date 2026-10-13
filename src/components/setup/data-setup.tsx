"use client";
import Link from "next/link";
import { CheckCircle2, CircleDashed, AlertTriangle } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { mlabel, type SalesData } from "@/lib/engine";
import type { ItemStatus, SectorReadiness } from "@/lib/company/readiness";
import { SectorPanel, TemplateButton, useReadiness } from "./readiness-view";
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
export function DataSetup({ sales }: { sales: SalesData | null }) {
  const c = useCompany();
  const all = useReadiness(sales);
  const by = (k: SectorReadiness["key"]) => all.find((r) => r.key === k);
  const fin = by("financials");
  const upload = (step: string) => `${c.basePath}/settings/source-data?step=${step}`;
  const steps: { n: number; title: string; status: ItemStatus; why: string; how: React.ReactNode; actions: React.ReactNode; testId: string }[] = [
    {
      n: 1, title: "Company profile", status: "done", testId: "step-profile",
      why: "The currency, the month the financial year starts and the tax rate are used in every figure.",
      how: <>Now: {c.settings.currency}, financial year from {MONTHS[c.settings.fyStartMonth - 1]}, tax {(c.settings.taxRate * 100).toFixed(1)}%.</>,
      actions: <Link href={`${c.basePath}/settings/profile`} className="text-sm text-brand-d underline">Check the profile</Link>,
    },
    {
      n: 2, title: "Monthly financials (P&L and balance sheet)", status: sectorStatus(fin), testId: "step-financials",
      why: "Every Financials page, the cash flow, Banking and the forecast are built from these months. A balance sheet for every month, plus the month before the first one, gives a complete cash flow.",
      how: (
        <ol className="list-decimal space-y-1 pl-5">
          <li><b>From Odoo (best):</b> Accounting → Reporting → <b>General Ledger</b>, from the first day of the financial year to today, with Initial Balance ticked → Export XLSX.</li>
          <li><b>Or without Odoo:</b> download the monthly financials template, enter each month&apos;s P&amp;L and month-end balances with the class of each account, and upload it. Every figure is read exactly as entered.</li>
        </ol>
      ),
      actions: <><TemplateButton kind="financials" /><Link href={upload("financials")} className="rounded bg-brand-d px-3 py-1.5 text-sm text-white" data-testid="upload-financials">Upload</Link></>,
    },
    {
      n: 3, title: "Proof files (optional)", status: "done", testId: "step-proof",
      why: "A Trial Balance and Profit and Loss for the same dates, uploaded with the General Ledger, prove the import account by account. They are never counted twice.",
      how: <>Odoo: Accounting → Reporting → <b>Trial Balance</b> and <b>Profit and Loss</b>, same dates → Export XLSX. Upload all three files together.</>,
      actions: <Link href={upload("financials")} className="text-sm text-brand-d underline">Upload with the ledger</Link>,
    },
    {
      n: 4, title: "Sales lines", status: sectorStatus(by("sales")), testId: "step-sales",
      why: "Sales by customer, product and category. The General Ledger already gives them; an invoice export adds quantities, salespeople and margins.",
      how: (
        <ol className="list-decimal space-y-1 pl-5">
          <li><b>From Odoo:</b> Invoicing → Reporting → <b>Invoice Analysis</b> → list view → select Invoice Date, Number, Partner, Product, Product Category, Salesperson, Quantity, Untaxed Total, Margin → Export.</li>
          <li><b>Or:</b> download the sales template, one row per invoice line, and upload it.</li>
        </ol>
      ),
      actions: <><TemplateButton kind="sales" /><Link href={upload("sales")} className="rounded bg-brand-d px-3 py-1.5 text-sm text-white" data-testid="upload-sales">Upload</Link></>,
    },
    {
      n: 5, title: "Banking inputs", status: sectorStatus(by("banking")), testId: "step-banking",
      why: "The facility you want, your borrowing rate and the loan principal due over the next 12 months make debt service and the bank memo exact.",
      how: <>Enter them on the Banking page (from your facility letters and repayment schedules).</>,
      actions: <Link href={`${c.basePath}/banking`} className="rounded bg-brand-d px-3 py-1.5 text-sm text-white">Open Banking</Link>,
    },
    {
      n: 6, title: "Forecast drivers", status: sectorStatus(by("forecast")), testId: "step-forecast",
      why: "Growth, margin, customer/stock/supplier days and loan plans. Measured from your months by default; review and save them.",
      how: <>On the Forecast page, check each driver and press Save.</>,
      actions: <Link href={`${c.basePath}/analysis/forecast`} className="rounded bg-brand-d px-3 py-1.5 text-sm text-white">Open Forecast</Link>,
    },
    {
      n: 7, title: "Targets", status: c.settings.targets && Object.keys(c.settings.targets).length ? "done" : "partial", testId: "step-targets",
      why: "Your own targets make the on-track and off-track scoring meaningful (otherwise general defaults are used).",
      how: <>Set 3–5 targets that matter to you (revenue, gross margin, customer days…).</>,
      actions: <Link href={`${c.basePath}/settings/targets`} className="text-sm text-brand-d underline">Set targets</Link>,
    },
  ];
  const latest = [...c.months].map((m) => m.period).sort().pop();
  return (
    <div data-testid="data-setup">
      <div className="label">1 · Data setup</div>
      <h1 className="mb-1 text-3xl font-light">Set up your data, step by step</h1>
      <p className="mb-6 text-mute">Each step says what to provide and exactly how. Use the Odoo exports, or download iReport&apos;s templates, fill them in and upload them: templates are read exactly, and any mistake is listed with its sheet, row and fix.{latest ? ` Latest month loaded: ${mlabel(latest)}.` : ""}</p>
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
                <p className="mt-0.5 text-sm text-mute">{s.why}</p>
                <div className="mt-2 text-sm">{s.how}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">{s.actions}</div>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <h2 className="mb-1 text-xl font-light">How complete and accurate each sector&apos;s data is</h2>
      <p className="mb-4 text-sm text-mute">The teal shape shows what is loaded; the orange line how much of it passes the accounting checks. Each point is one item below, with what to do about it.</p>
      <div className="space-y-5">{all.map((r) => <SectorPanel key={r.key} r={r} basePath={c.basePath} />)}</div>
    </div>
  );
}

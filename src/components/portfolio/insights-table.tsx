"use client";
import { ArrowDownUp, Check, Columns3, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { mlabel, money, num, type MonthData, type Unit } from "@/lib/engine";
import { monthCalcs, type MonthCalc } from "@/components/analysis/metrics";
import { Sparkline } from "@/components/charts/spark";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/cn";

export interface DashCompany { id: string; name: string; currency: string; taxRate: number; months: MonthData[]; source: string }
interface Metric { key: string; label: string; group: string; unit: Unit; get: (m: MonthCalc) => number | null; good?: "up" | "down" }

const P = (k: string) => (m: MonthCalc) => (m.P as unknown as Record<string, number>)[k] ?? null;
const B = (k: string) => (m: MonthCalc) => (m.B as unknown as Record<string, number>)[k] ?? null;
const K = (k: string) => (m: MonthCalc) => m.K[k] ?? null;
const W = (k: "ocf" | "fcf" | "ncf") => (m: MonthCalc) => m.W?.[k] ?? null;
const pctOf = (a: string) => (m: MonthCalc) => (m.P.revenue ? ((m.P as unknown as Record<string, number>)[a] / m.P.revenue) * 100 : null);

const METRICS: Metric[] = [
  { key: "revenue", label: "Revenue", group: "Revenue & Expenses", unit: "cur", get: P("revenue") },
  { key: "cos", label: "Cost of Sales", group: "Revenue & Expenses", unit: "cur", get: P("cos"), good: "down" },
  { key: "expenses", label: "Expenses", group: "Revenue & Expenses", unit: "cur", get: P("expenses"), good: "down" },
  { key: "gross_profit", label: "Gross Profit", group: "Profitability", unit: "cur", get: P("gross_profit") },
  { key: "net_income", label: "Net Profit", group: "Profitability", unit: "cur", get: P("net_income") },
  { key: "ebitda", label: "EBITDA", group: "Profitability", unit: "cur", get: P("ebitda") },
  { key: "operating_profit", label: "Operating Profit", group: "Profitability", unit: "cur", get: P("operating_profit") },
  { key: "gpm", label: "Gross Profit Margin", group: "Profitability", unit: "%", get: K("gpm") },
  { key: "nim", label: "Net Income Margin", group: "Profitability", unit: "%", get: pctOf("net_income") },
  { key: "opm", label: "Operating Profit Margin", group: "Profitability", unit: "%", get: K("opm") },
  { key: "ebitda_margin", label: "EBITDA Margin", group: "Profitability", unit: "%", get: K("ebitda_margin") },
  { key: "cash", label: "Cash on Hand", group: "Cash Flow", unit: "cur", get: B("cash") },
  { key: "ocf", label: "Operating Cash Flow", group: "Cash Flow", unit: "cur", get: W("ocf") },
  { key: "fcf", label: "Free Cash Flow", group: "Cash Flow", unit: "cur", get: W("fcf") },
  { key: "ncf", label: "Net Cash Flow", group: "Cash Flow", unit: "cur", get: W("ncf") },
  { key: "inventory", label: "Inventory", group: "Assets", unit: "cur", get: B("inventory") },
  { key: "tca", label: "Current Assets", group: "Assets", unit: "cur", get: B("tca") },
  { key: "tnca", label: "Non-Current Assets", group: "Assets", unit: "cur", get: B("tnca") },
  { key: "ta", label: "Total Assets", group: "Assets", unit: "cur", get: B("ta") },
  { key: "tcl", label: "Current Liabilities", group: "Liabilities", unit: "cur", get: B("tcl"), good: "down" },
  { key: "tncl", label: "Non-Current Liabilities", group: "Liabilities", unit: "cur", get: B("tncl"), good: "down" },
  { key: "tl", label: "Total Liabilities", group: "Liabilities", unit: "cur", get: B("tl"), good: "down" },
  { key: "tax_liab", label: "Tax Liability", group: "Liabilities", unit: "cur", get: B("tax_liab"), good: "down" },
  { key: "ar", label: "Accounts Receivable", group: "Working Capital", unit: "cur", get: B("ar"), good: "down" },
  { key: "ap", label: "Accounts Payable", group: "Working Capital", unit: "cur", get: B("ap") },
  { key: "ar_days", label: "AR Days", group: "Working Capital", unit: "days", get: K("ar_days"), good: "down" },
  { key: "ap_days", label: "AP Days", group: "Working Capital", unit: "days", get: K("ap_days") },
  { key: "current", label: "Current Ratio", group: "Working Capital", unit: "ratio", get: K("current") },
  { key: "inv_days", label: "Inventory Days", group: "Working Capital", unit: "days", get: K("inv_days"), good: "down" },
  { key: "ccc", label: "Cash Conversion Cycle", group: "Working Capital", unit: "days", get: K("ccc"), good: "down" },
  { key: "quick", label: "Quick Ratio", group: "Working Capital", unit: "ratio", get: K("quick") },
  { key: "wip", label: "Work in Progress", group: "Working Capital", unit: "cur", get: B("wip") },
  { key: "debt", label: "Total Debt", group: "Debt & Equity", unit: "cur", get: B("debt"), good: "down" },
  { key: "te", label: "Total Equity", group: "Debt & Equity", unit: "cur", get: B("te") },
  { key: "debt_equity", label: "Debt to Equity", group: "Debt & Equity", unit: "%", get: K("debt_equity"), good: "down" },
  { key: "roce", label: "Return On Capital Employed", group: "Debt & Equity", unit: "%", get: K("roce") },
  { key: "roe", label: "Return On Equity", group: "Debt & Equity", unit: "%", get: K("roe") },
];

export function InsightsTable({ companies }: { companies: DashCompany[] }) {
  const [sel, setSel] = useState<string[]>(["revenue", "gpm", "net_income", "cash", "ar_days", "current"]);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const rows = useMemo(() => companies.map((c) => {
    const calcs = monthCalcs(c.months, c.taxRate);
    return { c, calcs, last: calcs[calcs.length - 1], prev: calcs[calcs.length - 2] };
  }), [companies]);
  const metrics = sel.map((k) => METRICS.find((m) => m.key === k)!);
  const val = (r: (typeof rows)[number], m: Metric) => (r.last ? m.get(r.last) : null);
  const shown = rows.filter((r) => r.c.name.toLowerCase().includes(q.toLowerCase())).sort((a, b) => {
    if (sort.key === "name") return a.c.name.localeCompare(b.c.name) * sort.dir;
    const m = METRICS.find((x) => x.key === sort.key)!;
    return ((val(a, m) ?? -Infinity) - (val(b, m) ?? -Infinity)) * sort.dir;
  });
  const fmt = (v: number | null, m: Metric, cur: string) => (m.unit === "cur" ? money(v, cur, true) : num(v, m.unit, cur));
  const groups = [...new Set(METRICS.map((m) => m.group))];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 rounded border border-line px-2.5 py-1.5 text-sm"><Search className="h-4 w-4 text-mute" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" className="outline-none" /></label>
        <Popover>
          <PopoverTrigger className="flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-sm hover:bg-band" data-testid="metric-picker"><Columns3 className="h-4 w-4" />Metrics ({sel.length}/6)</PopoverTrigger>
          <PopoverContent className="max-h-96 w-72 overflow-auto">
            <div className="px-2 pb-1 text-xs text-mute">Select up to 6 metrics</div>
            {groups.map((g) => (
              <div key={g}>
                <div className="label px-2 pt-2">{g}</div>
                {METRICS.filter((m) => m.group === g).map((m) => {
                  const on = sel.includes(m.key);
                  return (
                    <button key={m.key} disabled={!on && sel.length >= 6} onClick={() => setSel(on ? sel.filter((x) => x !== m.key) : [...sel, m.key])}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-band disabled:opacity-40">
                      <Check className={cn("h-4 w-4 text-green-d", !on && "invisible")} />{m.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </PopoverContent>
        </Popover>
        <span className="ml-auto text-sm text-mute">{companies.length} {companies.length === 1 ? "company" : "companies"}</span>
      </div>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[900px] border-collapse text-[13px]" data-testid="insights-table">
          <thead>
            <tr className="border-b border-ink">
              <th className="sticky left-0 bg-white px-2 py-2 text-left"><SortBtn label="Company" active={sort.key === "name"} dir={sort.dir} onClick={() => setSort({ key: "name", dir: sort.key === "name" ? (-sort.dir as 1 | -1) : 1 })} /></th>
              {metrics.map((m) => {
                const vals = shown.map((r) => val(r, m)).filter((v): v is number => v !== null);
                const avg = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
                return (
                  <th key={m.key} colSpan={3} className="border-l border-line px-2 py-2 text-left align-bottom">
                    <SortBtn label={m.label} active={sort.key === m.key} dir={sort.dir} onClick={() => setSort({ key: m.key, dir: sort.key === m.key ? (-sort.dir as 1 | -1) : -1 })} />
                    <div className="text-[11px] font-normal text-mute">Avg {fmt(avg, m, companies[0]?.currency ?? "")}</div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.c.id} className="border-b border-line hover:bg-[#fafaf8]">
                <td className="sticky left-0 bg-white px-2 py-2">
                  <Link href={`/company/${r.c.id}/summary`} className="font-medium hover:underline">{r.c.name}</Link>
                  <div className="text-[11px] text-mute">{r.last ? mlabel(r.last.period) : "No data"}</div>
                </td>
                {metrics.map((m) => {
                  const v = val(r, m);
                  const p = r.prev ? m.get(r.prev) : null;
                  const g = v !== null && p ? ((v - p) / Math.abs(p)) * 100 : null;
                  const good = g === null ? null : (m.good === "down" ? g <= 0 : g >= 0);
                  return [
                    <td key={m.key + "v"} className="num border-l border-line px-2 py-2 text-right">{fmt(v, m, r.c.currency)}</td>,
                    <td key={m.key + "g"} className="px-1 py-2">{g !== null && <span className={cn("rounded px-1.5 py-0.5 text-[11px]", good ? "bg-green-bg text-green-d" : "bg-red-bg text-red")}>{g > 0 ? "▲" : "▼"} {Math.abs(g).toFixed(1)}%</span>}</td>,
                    <td key={m.key + "s"} className="px-1 py-2"><Sparkline values={r.calcs.slice(-12).map((x) => m.get(x))} w={70} h={22} color={good === false ? "#D9343A" : "#7CB46B"} /></td>,
                  ];
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-6 text-center text-sm text-mute">You&apos;ve reached the bottom! Would you like to <Link href="/companies" className="text-green-d underline">add more companies</Link>?</p>
    </div>
  );
}

function SortBtn({ label, active, dir, onClick }: { label: string; active: boolean; dir: 1 | -1; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-mute hover:text-ink">
      {label}<ArrowDownUp className={cn("h-3 w-3", active ? "text-ink" : "opacity-40", active && dir === -1 && "rotate-180")} />
    </button>
  );
}

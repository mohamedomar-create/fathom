import type { Metadata } from "next";
import { loadPortfolio } from "@/lib/company/portfolio";
import { AppBar } from "@/components/shell/app-bar";
import { InsightsTable } from "@/components/portfolio/insights-table";

export const metadata: Metadata = { title: "Insights Dashboard" };

export default async function DashboardPage() {
  const { items, orgs, email } = await loadPortfolio();
  const total = items.length;
  const withData = items.filter((i) => i.months.length).length;
  const risks = items.reduce((s, i) => s + (i.analysis?.findings.filter((f) => f.kind === "risk" && f.sev >= 3).length ?? 0), 0);
  return (
    <>
      <AppBar email={email} orgName={orgs[0]?.name} isAdmin={orgs.some((o) => o.role === "admin")} active="dashboard" />
      <main className="px-4 pb-16 pt-6 sm:px-8">
        <div className="-mx-4 mb-6 bg-band px-4 py-5 sm:-mx-8 sm:px-8">
          <h1 className="text-[32px] font-normal">Insights Dashboard</h1>
          <div className="mt-2 flex flex-wrap gap-6 text-sm">
            <span><b className="text-lg font-semibold">{total}</b> <span className="text-mute">companies</span></span>
            <span><b className="text-lg font-semibold">{withData}</b> <span className="text-mute">with data</span></span>
            <span><b className={`text-lg font-semibold ${risks ? "text-red" : ""}`}>{risks}</b> <span className="text-mute">serious risks flagged (latest month)</span></span>
          </div>
        </div>
        <InsightsTable companies={items.filter((i) => i.months.length).map((i) => ({ id: i.company.id, name: i.company.name, currency: i.company.currency, taxRate: Number(i.company.tax_rate), months: i.months, source: i.company.source }))} />
      </main>
    </>
  );
}

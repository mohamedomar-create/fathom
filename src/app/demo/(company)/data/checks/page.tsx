import { DataHealth } from "@/components/settings/data-health";
import { coverageOf, runChecks } from "@/lib/company/checks";
import { demoCompany } from "@/lib/company/demo";
import { statementOf } from "@/lib/company/import-plan";
import { demoInventoryState } from "@/lib/company/demo-inventory";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { StockChecks } from "@/components/inventory/stock-checks";
import { getDict } from "@/lib/i18n/server";

export default async function DemoDataHealth() {
  const t = (await getDict()).dat.pages;
  const c = demoCompany();
  const cov = coverageOf(c.accounts);
  const sources: Record<string, { importId: string | null; file: string; at: string | null; by: string | null }[]> = {};
  for (const a of c.accounts) for (const p of Object.keys(a.amounts)) sources[`${statementOf(a.cls)}|${p}`] ??= [{ importId: null, file: t.demoData, at: null, by: null }];
  return (
    <div>
      <h2 className="mb-1 text-xl font-light">{t.checksTitle}</h2>
      <p className="mb-6 text-mute">{t.checksSub}</p>
      <DataHealth companyId="demo" readOnly justImported={false} coverage={{ range: cov.range, pl: [...cov.pl], bs: [...cov.bs] }}
        checks={runChecks({ accounts: c.accounts, months: c.months })} accepted={[]} sources={sources} history={[]} />
      <StockChecks inventory={demoInventoryState()} expenses={demoExpenses()} />
    </div>
  );
}

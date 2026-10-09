import { DataHealth } from "@/components/settings/data-health";
import { coverageOf, runChecks } from "@/lib/company/checks";
import { demoCompany } from "@/lib/company/demo";
import { statementOf } from "@/lib/company/import-plan";

export default function DemoDataHealth() {
  const c = demoCompany();
  const cov = coverageOf(c.accounts);
  const sources: Record<string, { importId: string | null; file: string; at: string | null; by: string | null }[]> = {};
  for (const a of c.accounts) for (const p of Object.keys(a.amounts)) sources[`${statementOf(a.cls)}|${p}`] ??= [{ importId: null, file: "Demo data", at: null, by: null }];
  return (
    <div>
      <div className="label">2 · Data Health</div>
      <h1 className="mb-1 text-3xl font-light">Data health</h1>
      <p className="mb-6 text-mute">Which months are loaded, where each one came from, and whether the accounting checks pass.</p>
      <DataHealth companyId="demo" readOnly justImported={false} coverage={{ range: cov.range, pl: [...cov.pl], bs: [...cov.bs] }}
        checks={runChecks({ accounts: c.accounts, months: c.months })} accepted={[]} sources={sources} history={[]} />
    </div>
  );
}

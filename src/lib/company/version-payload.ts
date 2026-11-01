// The stored-version shapes, without the database: shared by the signed-in saves (persist.ts) and the nightly sync.
import type { ClassKey } from "@/lib/engine";
import { isPL, toNatural, toRaw } from "./build";
import type { AccountInput } from "./persist";
import type { SourceRef, VersionAccount } from "./import-plan";

/** The accounts as save_company_version takes them (stored sign, rounded to the cent). */
export function versionPayload(accounts: (AccountInput | VersionAccount)[]) {
  return accounts.map((a) => {
    const v = a as VersionAccount;
    return {
      code: a.code, name: a.name, statement: isPL(a.cls) ? "PL" : "BS", class: a.cls,
      odoo_id: a.odoo_id ?? null, odoo_type: a.odoo_type ?? null, confidence: a.confidence ?? null, mapped_by: a.mapped_by ?? "auto",
      amounts: Object.fromEntries(Object.entries(a.amounts).filter(([, x]) => x).map(([p, x]) => [p, Math.round(toRaw(a.cls, x) * 100) / 100])),
      sources: v.sources ?? {},
      refs: v.refs ?? {},
    };
  });
}

/** One stored version from its accounts and their balances (the balances' import ids become each month's source). */
export function versionFrom(accts: { id: string; code: string; name: string; class: string; odoo_id: number | null; odoo_type: string | null; confidence: number | null; mapped_by: string | null; refs: unknown }[], bal: { account_id: string; period: string; amount: number; import_id: string | null }[]): VersionAccount[] {
  const byId = new Map(accts.map((a) => [a.id, {
    code: a.code, name: a.name, cls: a.class as ClassKey, amounts: {} as Record<string, number>, sources: {} as Record<string, string | null>,
    refs: (a.refs ?? {}) as Record<string, SourceRef>, odoo_id: a.odoo_id, odoo_type: a.odoo_type, confidence: a.confidence,
    mapped_by: a.mapped_by as VersionAccount["mapped_by"],
  } satisfies VersionAccount]));
  for (const b of bal) {
    const a = byId.get(b.account_id);
    if (!a) continue;
    a.amounts[b.period] = toNatural(a.cls, Number(b.amount));
    a.sources[b.period] = b.import_id;
  }
  return [...byId.values()];
}


"use client";
import { useMemo, useState } from "react";
import { useCompany } from "@/lib/company/context";
import { cleanPlan, planFromAql, type BusinessPlan, type PlanLabels } from "@/lib/engine/plan";
import type { SalesProductRow } from "@/lib/engine/sales";
import { demoSales } from "@/lib/company/demo-sales";
import { createPlan, deletePlan, savePlan } from "@/app/company/[id]/planning/actions";
import { PlanWorkspace, demoStore, type PlanStore } from "./plan-workspace";
import { usePlanT } from "./plan-ui";

function useSeed(products: SalesProductRow[]) {
  const c = useCompany();
  return (startYear: number, labels: PlanLabels) => planFromAql({ months: c.months, sales: { products }, accounts: c.accounts, settings: c.settings, startYear, labels }) as unknown as Record<string, unknown>;
}

/** The company's business plans, kept in the database (editors save; viewers read). */
export function CompanyPlan({ plans, products, loadError }: { plans: BusinessPlan[]; products: SalesProductRow[]; loadError?: string }) {
  const c = useCompany();
  const { t } = usePlanT();
  const seed = useSeed(products);
  const store: PlanStore = useMemo(() => ({
    create: (input) => createPlan(c.id, input), save: (id, plan) => savePlan(c.id, id, plan), remove: (id) => deletePlan(c.id, id),
  }), [c.id]);
  if (loadError === "missing") return <p className="py-16 text-center text-mute" data-testid="plan-needs-update">{t("Business plans need the latest database update (0054). Ask the site owner to run it.")}</p>;
  if (loadError) return <p className="py-16 text-center text-red" role="alert">{t("The business plans couldn't be loaded just now. Your data is safe; try again in a moment.")}</p>;
  return <PlanWorkspace initial={plans} store={store} seed={seed} cur={c.settings.currency} company={c.name} readOnly={c.readOnly} />;
}

/** The demo's plan: started from the demo company's books, kept in memory only. */
export function DemoPlan() {
  const c = useCompany();
  const { t, lang } = usePlanT();
  const products = useMemo(() => demoSales().products, []);
  const seed = useSeed(products);
  const [store] = useState(demoStore);
  const [initial] = useState<BusinessPlan[]>(() => {
    const last = c.months.at(-1)?.period.slice(0, 4);
    const startYear = last ? Number(last) + 1 : new Date().getFullYear() + 1;
    const labels: PlanLabels = { loans: t("Existing loans"), other: t("Other sales"), overheads: t("Overheads"), lang };
    return [{ ...cleanPlan({ name: t("Business plan {from}–{to}", { from: startYear, to: startYear + 4 }), startYear, years: 5, ...seed(startYear, labels) }), id: "demo_plan", createdBy: "demo", updatedAt: "" }];
  });
  return <PlanWorkspace initial={initial} store={store} seed={seed} cur={c.settings.currency} company={c.name} readOnly={false} note={t("Demo: changes are kept until you leave the page.")} />;
}

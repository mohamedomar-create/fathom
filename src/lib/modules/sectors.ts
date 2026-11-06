// Where each module's page sits in the navigation. Kept apart from the definitions so the navigation stays light; the
// module contract suite checks it matches every definition.
export const MODULE_SECTOR: Record<string, string> = { sales: "sales", expenses: "expenses", ar_open: "payments", ap_open: "payments", payments: "payments", purchasing: "expenses",
  hr: "modules", payroll: "modules", crm: "modules", manufacturing: "modules", projects: "modules", pos: "modules", assets: "modules", fleet: "modules", service: "modules" };

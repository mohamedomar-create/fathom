// An in-memory Odoo that answers the JSON-RPC calls the connector makes, built from the sample company's journal.
import { accounts, months } from "./odoo";
import { isPL, toRaw } from "@/lib/company/build";
import type { ClassKey } from "@/lib/engine";

const TYPE: Partial<Record<ClassKey, string>> = {
  revenue: "income", cos_variable: "expense_direct_cost", cos_depreciation: "expense_direct_cost", exp_variable: "expense", exp_fixed: "expense",
  other_income: "income", other_expenses: "expense", interest_income: "income_other", interest_expenses: "expense", tax_expenses: "expense",
  cash: "asset_cash", ar: "asset_receivable", inventory: "asset_current", fixed_assets: "asset_fixed", std: "liability_current", ap: "liability_payable",
  tax_liab: "liability_current", other_equity: "equity",
};
const V15: Record<string, string> = Object.fromEntries(Object.entries({
  asset_cash: "data_account_type_liquidity", asset_receivable: "data_account_type_receivable", asset_current: "data_account_type_current_assets",
  asset_fixed: "data_account_type_fixed_assets", liability_current: "data_account_type_current_liabilities", liability_payable: "data_account_type_payable",
  equity: "data_account_type_equity", income: "data_account_type_revenue", income_other: "data_account_type_other_income",
  expense_direct_cost: "data_account_type_direct_costs", expense: "data_account_type_expenses",
}));

interface Line { account: number; date: string; balance: number; company: number }

export function buildLedger() {
  const accs = accounts.filter((a) => a.cls !== "retained_earnings").map((a, i) => ({ id: 100 + i, code: a.code, name: a.name, cls: a.cls, type: TYPE[a.cls]! }));
  const byCode = new Map(accs.map((a) => [a.code, a]));
  const lines: Line[] = [];
  const ps = months.map((m) => m.period);
  ps.forEach((p, pi) => {
    let check = 0;
    for (const a of accounts) {
      if (a.cls === "retained_earnings" || a.cls === "other_equity") continue;
      const prev = pi > 0 ? a.amounts[ps[pi - 1]] ?? 0 : 0;
      const nat = isPL(a.cls) ? a.amounts[p] ?? 0 : (a.amounts[p] ?? 0) - prev;
      const raw = toRaw(a.cls, nat);
      if (!raw) continue;
      lines.push({ account: byCode.get(a.code)!.id, date: `${p}-15`, balance: raw, company: 1 });
      check += raw;
    }
    lines.push({ account: byCode.get(pi === 0 ? "300000" : "301000")!.id, date: `${p}-15`, balance: -check, company: 1 });
  });
  // noise in another company that must be filtered out
  lines.push({ account: 100, date: `${ps[3]}-10`, balance: 999999, company: 2 });
  return { accs, lines };
}

type Leaf = [string, string, unknown];
function match(l: Line, dom: unknown[]): boolean {
  return dom.every((d) => {
    const [f, op, v] = d as Leaf;
    if (f === "parent_state") return true;
    if (f === "company_id") return op === "=" ? l.company === v : op === "child_of" ? l.company === v : false;
    if (f === "date") return op === "<" ? l.date < (v as string) : op === ">=" ? l.date >= (v as string) : op === "<=" ? l.date <= (v as string) : false;
    throw new Error(`unexpected domain ${f}`);
  });
}

export function fakeOdoo(version: 15 | 17 | 18 | 19) {
  const { accs, lines } = buildLedger();
  const calls: string[] = [];
  const handler = async (_url: string | URL | Request, init?: RequestInit) => {
    const { params } = JSON.parse(String(init!.body));
    const { service, method, args } = params;
    calls.push(`${service}.${method}${service === "object" ? ":" + args[3] + "." + args[4] : ""}`);
    let result: unknown;
    if (service === "common" && method === "version") result = { server_version: `${version}.0`, server_version_info: [version, 0, 0, "final", 0, ""] };
    else if (service === "common" && method === "authenticate") result = args[2] === "secret" ? 7 : false;
    else if (service === "object") {
      const [, , , model, m, a, kw] = args;
      if (model === "res.company") result = [{ id: 1, name: "Sample Trading Co", currency_id: [1, "EGP"] }, { id: 2, name: "Other Co", currency_id: [1, "EGP"] }];
      else if (model === "account.account") {
        const dom = a[0][0];
        if (version >= 18 && dom[0] !== "company_ids") throw new Error("v18 needs company_ids");
        if (version < 18 && dom[0] !== "company_id") throw new Error("v<18 needs company_id");
        if (kw.context?.allowed_company_ids?.[0] !== 1) throw new Error("missing allowed_company_ids");
        result = accs.map((x) => version >= 16 ? { id: x.id, code: x.code, name: x.name, account_type: x.type } : { id: x.id, code: x.code, name: x.name, user_type_id: [500 + Object.keys(V15).indexOf(x.type), x.type] });
      } else if (model === "ir.model.data") {
        result = Object.keys(V15).map((t, i) => ({ res_id: 500 + i, name: V15[t] }));
      } else if (model === "account.move.line" && m === "read_group") {
        if (version >= 19) return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "Odoo Server Error", data: { name: "AttributeError", message: "read_group is not allowed on this model; use formatted_read_group" } } }));
        if (kw.lazy !== false) throw new Error("lazy must be false");
        const [dom, , groupby] = a;
        const sel = lines.filter((l) => match(l, dom));
        const g = new Map<string, { account_id: [number, string]; balance: number; month?: string }>();
        for (const l of sel) {
          const month = groupby.includes("date:month") ? l.date.slice(0, 7) : undefined;
          const k = `${l.account}|${month ?? ""}`;
          const cur = g.get(k) ?? { account_id: [l.account, "x"], balance: 0, month };
          cur.balance += l.balance; g.set(k, cur);
        }
        result = [...g.values()].map((x) => {
          const r: Record<string, unknown> = { account_id: x.account_id, balance: x.balance, __count: 1 };
          if (x.month) {
            const from = `${x.month}-01`;
            r["date:month"] = "translated label";
            if (version >= 16) r.__range = { "date:month": { from, to: "next" } };
            else r.__domain = ["&", ["date", ">=", from], ["date", "<", "next"], ["account_id", "=", x.account_id[0]]];
          }
          return r;
        });
      } else if (model === "account.move.line" && m === "search_read") {
        const sel = lines.filter((l) => match(l, a[0]));
        result = sel.slice(kw.offset, kw.offset + kw.limit).map((l) => ({ account_id: [l.account, "x"], date: l.date, balance: l.balance }));
      } else throw new Error(`unexpected ${model}.${m}`);
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  return { fetch: handler as unknown as typeof fetch, calls };
}

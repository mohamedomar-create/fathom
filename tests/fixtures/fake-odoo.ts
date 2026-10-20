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

interface Line { account: number; date: string; balance: number; company: number; move?: string; partner?: string; created?: string }

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
      lines.push({ account: byCode.get(a.code)!.id, date: `${p}-15`, balance: raw, company: 1, move: `${a.cls === "revenue" ? "INV" : isPL(a.cls) ? "BILL" : "MISC"}/${p.slice(0, 4)}/${String(pi + 1).padStart(4, "0")}`, partner: a.cls === "revenue" ? "Northside Hospital" : isPL(a.cls) ? "Medline Supply" : "" });
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
    if (f === "account_id" && op === "in") return (v as number[]).includes(l.account);
    if (f === "create_date") return op === ">" && (l.created ?? "2020-01-01 00:00:00") > (v as string);
    if (f === "date") return op === "<" ? l.date < (v as string) : op === ">=" ? l.date >= (v as string) : op === "<=" ? l.date <= (v as string) : false;
    throw new Error(`unexpected domain ${f}`);
  });
}

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

/** offBalance: an off-balance account that holds posted lines (petty cash kept off the books, a memo account). */
/** late: an entry dated in August, posted (created) on 18 Oct 2026 after the last import. */
/** rights: what the connected user may do on accounting records ("read" = nothing, "write" = can change, "unknown" = Odoo won't say). */
/** userCompanies: the companies the connected user may see. */
/** custody: an employee's petty-cash custody account typed off-balance (as some charts do), coded next to the cash accounts. */
export function fakeOdoo(version: 15 | 17 | 18 | 19, opts: { offBalance?: boolean; late?: boolean; custody?: boolean; openingDate?: string; rights?: "read" | "write" | "admin" | "unknown"; userCompanies?: number[]; agency?: boolean; noSale?: boolean } = {}) {
  const { accs, lines } = buildLedger();
  if (opts.custody) {
    accs.push({ id: 901, code: "101400", name: "Hossam Hassan", cls: "cash", type: "off_balance" });
    const bank = accs.find((a) => a.code === "101100")!.id;
    lines.push({ account: 901, date: `${months[1].period}-05`, balance: 5000, company: 1 }, { account: bank, date: `${months[1].period}-05`, balance: -5000, company: 1 });
  }
  if (opts.offBalance) {
    accs.push({ id: 900, code: "999100", name: "Petty cash (off balance)", cls: "cash", type: "off_balance" });
    lines.push({ account: 900, date: `${months[2].period}-12`, balance: 4500, company: 1 }, { account: 900, date: `${months[2].period}-12`, balance: -4500, company: 1 });
    lines.push({ account: 900, date: `${months[3].period}-03`, balance: 1200, company: 1 });
  }
  if (opts.late) lines.push({ account: accs[0].id, date: "2026-08-15", balance: 6000, company: 1, created: "2026-10-18 06:36:00" }, { account: accs[1].id, date: "2026-08-15", balance: -6000, company: 1, created: "2026-10-18 06:36:00" });
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
      const detail = detailAnswer(model, m, a, kw, version, opts);
      if (detail && typeof detail === "object" && "__error" in detail) return json({ jsonrpc: "2.0", id: 1, error: { message: "Odoo Server Error", data: { name: "ValueError", message: (detail as { __error: string }).__error } } });
      if (detail !== undefined) result = detail;
      else if (m === "check_access_rights" || m === "has_access") {
        const rights = opts.rights ?? "read";
        if (rights === "unknown" || (m === "has_access" && version < 18) || (m === "check_access_rights" && version >= 18)) {
          return json({ jsonrpc: "2.0", id: 1, error: { message: "Odoo Server Error", data: { name: "AttributeError", message: `The method '${m}' does not exist on the model` } } });
        }
        result = (rights === "write" && model === "account.move") || (rights === "admin" && model === "res.users");
      } else if (model === "res.users") {
        if (m !== "read" || a[0][0] !== 7) throw new Error("only the user's own record");
        result = [{ id: 7, name: "iReport Reader", login: "me@x.com", company_ids: opts.userCompanies ?? [1] }];
      } else if (model === "res.company" && m === "read") {
        result = [{ id: a[0][0], account_opening_date: opts.openingDate ?? false }];
      } else if (model === "res.company") result = [{ id: 1, name: "Sample Trading Co", currency_id: [1, "EGP"] }, { id: 2, name: "Other Co", currency_id: [1, "EGP"] }];
      else if (model === "account.account") {
        const dom = a[0][0];
        if (version >= 18 && dom[0] !== "company_ids") throw new Error("v18 needs company_ids");
        if (version < 18 && dom[0] !== "company_id") throw new Error("v<18 needs company_id");
        if (kw.context?.allowed_company_ids?.[0] !== 1) throw new Error("missing allowed_company_ids");
        result = accs.map((x) => version >= 16 ? { id: x.id, code: x.code, name: x.name, account_type: x.type } : { id: x.id, code: x.code, name: x.name, user_type_id: [500 + Object.keys(V15).indexOf(x.type), x.type] });
      } else if (model === "ir.model.data") {
        result = Object.keys(V15).map((t, i) => ({ res_id: 500 + i, name: V15[t] }));
      } else if (model === "account.move.line" && m === "read_group") {
        if (version >= 19) return json({ jsonrpc: "2.0", id: 1, error: { message: "Odoo Server Error", data: { name: "AttributeError", message: "read_group is not allowed on this model; use formatted_read_group" } } });
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
      } else if (model === "account.move.line" && m === "search_count") {
        result = lines.filter((l) => match(l, a[0])).length;
      } else if (model === "account.move.line" && m === "search_read") {
        const sel = lines.filter((l) => match(l, a[0]));
        result = sel.slice(kw.offset, kw.offset + kw.limit).map((l) => ({ account_id: [l.account, "x"], date: l.date, balance: l.balance, move_id: l.move ? [1, l.move] : false, partner_id: l.partner ? [2, l.partner] : false, name: "line" }));
      } else throw new Error(`unexpected ${model}.${m}`);
    }
    return json({ jsonrpc: "2.0", id: 1, result });
  };
  return { fetch: handler as unknown as typeof fetch, calls };
}

// ---- sales and stock detail: a small, fully known set
const LOCS = [
  { id: 1, complete_name: "WH/Stock", usage: "internal" }, { id: 2, complete_name: "Partners/Vendors", usage: "supplier" },
  { id: 3, complete_name: "Partners/Customers", usage: "customer" }, { id: 4, complete_name: "Virtual Locations/Inventory adjustment", usage: "inventory" },
  { id: 5, complete_name: "Repair & Maintenance", usage: "inventory" },
];
const PRODUCTS = [{ id: 11, categ_id: [7, "All / Devices"] }, { id: 12, categ_id: [8, "All / Consumables"] }];
const BASE_LINES = [
  { id: 1, date: "2026-09-03", move_id: [101, "INV/2026/00001"], partner_id: [9, "Northside Hospital"], product_id: [11, "[P1] Oxygen Concentrator"], quantity: 2, balance: -50000, name: "x" },
  { id: 2, date: "2026-09-03", move_id: [101, "INV/2026/00001"], partner_id: [9, "Northside Hospital"], product_id: [12, "[P2] Nasal Cannula"], quantity: 10, balance: 0, name: "free" },
  { id: 3, date: "2026-09-20", move_id: [102, "RINV/2026/00001"], partner_id: [9, "Northside Hospital"], product_id: [11, "[P1] Oxygen Concentrator"], quantity: 1, balance: 25000, name: "return" },
];
// A buying agency (Egypt's Unified Procurement Authority) billed for hospitals: one line per way the hospital is recorded.
const UPA: [number, string] = [30, "الهيئة المصرية للشراء الموحد"];
const AGENCY_LINES = [
  { id: 4, date: "2026-09-29", move_id: [103, "INV2/2026/0901"], partner_id: UPA, product_id: [12, "[P2] Nasal Cannula"], quantity: 5, balance: -250000, name: "[P2] Nasal Cannula", sale_line_ids: [901] },
  { id: 5, date: "2026-09-30", move_id: [104, "INV2/2026/0902"], partner_id: UPA, product_id: [12, "[P2] Nasal Cannula"], quantity: 1, balance: -1000, name: "[P2] Nasal Cannula", sale_line_ids: [] },
  { id: 6, date: "2026-09-30", move_id: [105, "INV/2026/0100"], partner_id: UPA, product_id: [11, "[P1] Oxygen Concentrator"], quantity: 1, balance: -2000, name: "[P1] Oxygen Concentrator", sale_line_ids: [] },
  { id: 7, date: "2026-09-30", move_id: [106, "INV/2026/0101"], partner_id: UPA, product_id: false, quantity: 1, balance: -3000, name: "( PRO 501 / 22 ) - [Device] Airtech AE-8\nsecond line", sale_line_ids: [] },
  { id: 8, date: "2026-09-30", move_id: [107, "INV/2026/0102"], partner_id: UPA, product_id: [11, "[P1] Oxygen Concentrator"], quantity: 1, balance: -4000, name: "[P1] Oxygen Concentrator", sale_line_ids: [] },
];
const INVOICES = [{ id: 101, name: "INV/2026/00001", invoice_user_id: [5, "Sara Sales"], move_type: "out_invoice", partner_id: [9, "Northside Hospital"], partner_shipping_id: [9, "Northside Hospital"], invoice_origin: false },
  { id: 102, name: "RINV/2026/00001", invoice_user_id: [5, "Sara Sales"], move_type: "out_refund", partner_id: [9, "Northside Hospital"], partner_shipping_id: [9, "Northside Hospital"], invoice_origin: false },
  { id: 103, name: "INV2/2026/0901", invoice_user_id: false, move_type: "out_invoice", partner_id: UPA, partner_shipping_id: UPA, invoice_origin: "S00010" },
  { id: 104, name: "INV2/2026/0902", invoice_user_id: false, move_type: "out_invoice", partner_id: UPA, partner_shipping_id: UPA, invoice_origin: "S00011" },
  { id: 105, name: "INV/2026/0100", invoice_user_id: false, move_type: "out_invoice", partner_id: [31, "الهيئة المصرية للشراء الموحد (جامعه الربيع)"], partner_shipping_id: [31, "x"], invoice_origin: false },
  { id: 106, name: "INV/2026/0101", invoice_user_id: false, move_type: "out_invoice", partner_id: UPA, partner_shipping_id: UPA, invoice_origin: false },
  { id: 107, name: "INV/2026/0102", invoice_user_id: false, move_type: "out_invoice", partner_id: UPA, partner_shipping_id: [32, "مستشفى الرحمة المركزي-الشراء الموحد"], invoice_origin: false }];
const SALE_LINES = [{ id: 901, order_id: [801, "S00010"] }];
const ORDERS = [{ id: 801, name: "S00010", partner_id: [40, "مستشفى النور التخصصي-الشراء الموحد"], partner_shipping_id: [40, "x"] },
  { id: 802, name: "S00011", partner_id: [41, "مستشفى الشفاء العام"], partner_shipping_id: [41, "x"] }];
const MOVE_LINES = [
  { id: 201, date: "2026-08-10 09:00:00", reference: "WH/IN/00001", product_id: [11, "[P1] Oxygen Concentrator"], lot_id: false, location_id: [2, "Partners/Vendors"], location_dest_id: [1, "WH/Stock"], quantity: 5, qty_done: 5, product_uom_id: [1, "Units"], picking_partner_id: [20, "Medline Supply"] },
  { id: 202, date: "2026-09-03 10:00:00", reference: "WH/OUT/00001", product_id: [11, "[P1] Oxygen Concentrator"], lot_id: false, location_id: [1, "WH/Stock"], location_dest_id: [3, "Partners/Customers"], quantity: 2, qty_done: 2, product_uom_id: [1, "Units"], picking_partner_id: [9, "Northside Hospital"] },
  { id: 203, date: "2026-09-25 10:00:00", reference: "WH/INT/00002", product_id: [12, "[P2] Nasal Cannula"], lot_id: false, location_id: [1, "WH/Stock"], location_dest_id: [5, "Repair & Maintenance"], quantity: 3, qty_done: 3, product_uom_id: [1, "Units"], picking_partner_id: false },
];
const STOCK_MOVES = [{ id: 301, location_id: [2, "Partners/Vendors"], location_dest_id: [1, "WH/Stock"], partner_id: [20, "Medline Supply"] }, { id: 302, location_id: [1, "WH/Stock"], location_dest_id: [3, "Partners/Customers"], partner_id: [9, "Northside Hospital"] }];
const LAYERS = [
  { id: 401, create_date: "2026-08-31 22:30:00", product_id: [11, "[P1] Oxygen Concentrator"], quantity: 5, unit_cost: 10000, value: 50000, description: "WH/IN/00001 - Oxygen Concentrator", reference: "WH/IN/00001", stock_move_id: [301, "x"], stock_landed_cost_id: false, account_move_id: [501, "STJ/2026/0001"] },
  { id: 402, create_date: "2026-09-03 10:00:00", product_id: [11, "[P1] Oxygen Concentrator"], quantity: -2, unit_cost: 10000, value: -20000, description: "WH/OUT/00001", reference: "WH/OUT/00001", stock_move_id: [302, "x"], stock_landed_cost_id: false, account_move_id: [502, "STJ/2026/0002"] },
  { id: 403, create_date: "2026-09-10 10:00:00", product_id: [11, "[P1] Oxygen Concentrator"], quantity: 0, unit_cost: 0, value: 1500, description: "Landed cost", reference: "LC/2026/0001", stock_move_id: false, stock_landed_cost_id: [601, "LC/2026/0001"], account_move_id: false },
];
const JOURNAL = [{ id: 501, date: "2026-08-31" }, { id: 502, date: "2026-09-03" }];
const QUANTS = [{ id: 701, product_id: [11, "[P1] Oxygen Concentrator"], location_id: [1, "WH/Stock"], lot_id: false, quantity: 3, value: 31500 }];

const json500 = (message: string) => ({ __error: message });
const page = <T,>(rows: T[], kw: Record<string, unknown>) => rows.slice(Number(kw.offset ?? 0), Number(kw.offset ?? 0) + Number(kw.limit ?? rows.length));
const byIds = <T extends { id: number }>(rows: T[], ids: number[]) => rows.filter((r) => ids.includes(r.id));
function needsCompany(dom: unknown[]) { if (!dom.some((d) => Array.isArray(d) && d[0] === "company_id")) throw new Error("every detail read is limited to the company"); }

function detailAnswer(model: string, m: string, a: unknown[], kw: Record<string, unknown>, version: number, opts: { agency?: boolean; noSale?: boolean } = {}): unknown {
  const INV_LINES = opts.agency ? [...BASE_LINES, ...AGENCY_LINES] : BASE_LINES;
  if (m === "fields_get") {
    const f = model === "account.move.line" ? (opts.noSale ? ["name", "partner_id"] : ["name", "partner_id", "sale_line_ids"])
      : model === "account.move" ? ["name", "partner_id", "partner_shipping_id", "invoice_origin"]
      : model === "sale.order" && !opts.noSale ? ["name", "partner_id", "partner_shipping_id"] : null;
    if (!f) return json500(`Object ${model} doesn't exist`);
    return Object.fromEntries(f.map((k) => [k, { type: "char" }]));
  }
  if (model === "sale.order.line" || model === "sale.order") {
    if (opts.noSale) return json500(`Object ${model} doesn't exist`);
    for (const k of (kw.fields as string[] | undefined) ?? []) if (!["order_id", "name", "partner_id", "partner_shipping_id"].includes(k)) return json500(`Invalid field ${k} on ${model}`);
    if (model === "sale.order.line" && m === "read") return byIds(SALE_LINES, a[0] as number[]);
    if (model === "sale.order" && m === "read") return byIds(ORDERS, a[0] as number[]);
    if (model === "sale.order" && m === "search_read") { const names = ((a[0] as unknown[][]).find((d) => d[0] === "name")?.[2] ?? []) as string[]; return ORDERS.filter((o) => names.includes(o.name)); }
  }
  if (model === "account.move.line" && m === "search_read" && opts.noSale && ((kw.fields as string[] | undefined) ?? []).includes("sale_line_ids")) return json500("Invalid field sale_line_ids on account.move.line");
  if (model === "stock.location") return LOCS;
  if (model === "product.product" && m === "read") return byIds(PRODUCTS, a[0] as number[]);
  if (model === "account.move" && m === "read") return [...byIds(INVOICES, a[0] as number[]), ...byIds(JOURNAL, a[0] as number[])];
  if (model === "stock.move" && m === "read") return byIds(STOCK_MOVES, a[0] as number[]);
  if (model === "account.move.line" && (m === "search_read" || m === "search_count") && (a[0] as unknown[][]).some((d) => d[0] === "move_id.move_type")) {
    needsCompany(a[0] as unknown[]);
    if (!(a[0] as unknown[][]).some((d) => d[0] === (version >= 16 ? "display_type" : "exclude_from_invoice_tab"))) throw new Error("invoice lines only");
    return m === "search_count" ? INV_LINES.length : page(INV_LINES, kw);
  }
  const table = model === "stock.move.line" ? MOVE_LINES : model === "stock.valuation.layer" ? LAYERS : model === "stock.quant" ? QUANTS : null;
  if (!table) return undefined;
  needsCompany(a[0] as unknown[]);
  if (m === "search_count") return table.length;
  if (kw.order === "date asc" || kw.order === "create_date asc") return table.slice(0, 1);
  return page(table as unknown[], kw);
}

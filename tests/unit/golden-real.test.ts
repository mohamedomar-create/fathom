import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runChecks } from "@/lib/company/checks";
import { readWorkbooks } from "@/lib/ingest/read";
import { ingest, toAccountInputs } from "@/lib/ingest/pipeline";

// Real exports are never committed (this repository is public). Point GOLDEN_REAL_DIR at a folder holding an Odoo
// General Ledger, Trial Balance and Profit and Loss for the same dates to run this locally.
const dir = process.env.GOLDEN_REAL_DIR ?? "";
const today = process.env.GOLDEN_TODAY ?? new Date().toISOString().slice(0, 10);

describe.skipIf(!dir)("real Odoo exports (local only)", () => {
  it("the ledger gives the months; the trial balance and P&L agree account by account; totals match", async () => {
    const files = fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f)).map((f) => { const b = fs.readFileSync(path.join(dir, f)); return { name: f, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }; });
    const mapping = JSON.parse(process.env.GOLDEN_MAPPING ?? "{}");
    const res = ingest(await readWorkbooks(files), { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping, today });
    expect(res.layouts.filter((l) => l.role === "data").map((l) => l.source)).toEqual(["Odoo General Ledger"]);
    expect(res.layouts.filter((l) => l.role === "check")).toHaveLength(2);
    expect(res.issues.notes.filter((n) => /all \d+ account figures agree/.test(n))).toHaveLength(2);
    const checks = runChecks({ accounts: toAccountInputs(res).map((a, i) => ({ ...a, id: String(i) })), controls: res.controls, extra: res.checks });
    expect(res.controls.some((c) => c.metric === "net_income" && (c.months ?? 1) > 1)).toBe(true);
    expect(checks.filter((c) => ["control_total", "cross_check", "account_rollforward", "tb_zero"].includes(c.id))).toEqual([]);
    if (Object.keys(mapping).length) expect(checks.filter((c) => c.severity === "block")).toEqual([]);
  }, 120_000);
});

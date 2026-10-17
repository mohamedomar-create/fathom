import { describe, expect, it } from "vitest";
import { ingest, rememberKey, type IngestOptions } from "@/lib/ingest/pipeline";
import { rememberedEntries } from "@/lib/company/account-map";
import { OdooClient } from "@/lib/odoo/client";
import { syncOdoo } from "@/lib/odoo/sync";
import { odooReports } from "../fixtures/odoo";
import { fakeOdoo } from "../fixtures/fake-odoo";
import type { Grid } from "@/lib/ingest/extract";

const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {} };
const rename = (gs: Grid[], from: string, to: string): Grid[] => gs.map((g) => ({ ...g, rows: g.rows.map((r) => r.map((c) => (c === from ? to : c))) }));

describe("the company's account map", () => {
  it("keys an account by its code, or by its name when it has none", () => {
    expect(rememberKey({ code: "620300", label: "620300 Marketing" })).toBe("#620300");
    expect(rememberKey({ code: "", label: "Petty cash – Ahmed" })).toBe("petty cash – ahmed");
  });

  it("a class remembered by code follows the account when Odoo renames it", () => {
    const res = ingest(rename(odooReports(), "620300 Marketing", "620300 Advertising & Promotion"), { ...OPTS, mapping: { "#620300": "exp_variable" } });
    const l = res.lines.find((x) => x.code === "620300")!;
    expect(l.name).toBe("Advertising & Promotion");
    expect(l.cls).toBe("exp_variable");
    expect(l.why).toMatch(/your mapping/);
  });

  it("a choice made on this upload for one row beats the remembered class", () => {
    const base = ingest(odooReports(), OPTS);
    const row = base.lines.find((x) => x.code === "620300")!;
    const res = ingest(odooReports(), { ...OPTS, mapping: { "#620300": "exp_variable", [row.key]: "other_expenses" } });
    expect(res.lines.find((x) => x.code === "620300")!.cls).toBe("other_expenses");
  });

  it("what is remembered from an upload: the person's choices, by code, with the account's name", () => {
    const entries = rememberedEntries({ "#620300": "exp_variable", "petty cash": "cash", "Sheet1|12": "cash" }, [{ code: "620300", name: "Marketing" }]);
    expect(entries).toEqual([{ key: "#620300", cls: "exp_variable", name: "Marketing" }, { key: "petty cash", cls: "cash", name: "petty cash" }]);
  });

  it("an Odoo sync keeps a class the person chose", async () => {
    const f = fakeOdoo(17);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const plain = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 6, end: "2026-09" });
    const mk = plain.accounts.find((a) => a.code === "620300")!;
    expect(mk.cls).not.toBe("exp_variable");
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 6, end: "2026-09", classes: { "#620300": "exp_variable" } });
    expect(res.accounts.find((a) => a.code === "620300")).toMatchObject({ cls: "exp_variable", mapped_by: "user" });
  });
});

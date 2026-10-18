// iReport never writes to a company's Odoo: only reading methods can be sent, whatever the caller asks (spec WS6).
import { describe, expect, it } from "vitest";
import { OdooClient, OdooError, READ_METHODS } from "@/lib/odoo/client";

describe("the Odoo connection is read-only", () => {
  const sent: string[] = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    sent.push(`${body.params.service}.${body.params.method}${body.params.service === "object" ? ":" + body.params.args[4] : ""}`);
    return new Response(JSON.stringify({ result: body.params.method === "authenticate" ? 7 : [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", fetchImpl);

  it("allows exactly the five reading methods", async () => {
    expect([...READ_METHODS].sort()).toEqual(["fields_get", "read", "read_group", "search_count", "search_read"]);
    for (const m of READ_METHODS) await c.executeKw("account.move.line", m, [[]]);
    expect(sent.filter((s) => s.startsWith("object."))).toHaveLength(5);
  });

  it("refuses any other method before anything is sent", async () => {
    const before = sent.length;
    for (const m of ["create", "write", "unlink", "copy", "action_post", "button_validate", "message_post", "name_create", "load", "export_data", "Search_Read", "search_read "]) {
      await expect(c.executeKw("account.move", m, [[]])).rejects.toBeInstanceOf(OdooError);
    }
    expect(sent.length).toBe(before);
  });

  it("the raw call cannot reach Odoo's object or database services", async () => {
    const before = sent.length;
    const raw = c as unknown as { call: (s: string, m: string, a: unknown[]) => Promise<unknown> };
    await expect(raw.call("object", "execute_kw", ["db", 7, "secret", "res.partner", "unlink", [[1]]])).rejects.toBeInstanceOf(OdooError);
    await expect(raw.call("db", "drop", ["admin", "db"])).rejects.toBeInstanceOf(OdooError);
    expect(sent.length).toBe(before);
  });
});

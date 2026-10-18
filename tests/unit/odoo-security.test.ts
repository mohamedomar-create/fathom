// Layered protection on the live Odoo connection: only allowed models and the user's own record are read, the
// connected user is proven read-only, answers are checked before use, and the connection can be switched off.
import { afterEach, describe, expect, it } from "vitest";
import { OdooClient, OdooError } from "@/lib/odoo/client";
import { resolvePublicOdoo } from "@/lib/odoo/net";
import { probe, syncOdoo } from "@/lib/odoo/sync";
import { fakeOdoo } from "../fixtures/fake-odoo";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

function recorder(result: (model: string, method: string) => unknown = () => []) {
  const sent: string[] = [];
  const fetchImpl = (async (_u: string, init?: RequestInit) => {
    const { params } = JSON.parse(String(init?.body));
    sent.push(params.service === "object" ? `${params.args[3]}.${params.args[4]}` : `${params.service}.${params.method}`);
    const r = params.method === "authenticate" ? 7 : result(params.args[3], params.args[4]);
    return new Response(JSON.stringify({ result: r }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { sent, client: new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", fetchImpl) };
}

describe("only allowed Odoo models are read", () => {
  it("models outside the list are refused before anything is sent", async () => {
    const { sent, client } = recorder();
    await client.authenticate();
    for (const m of ["res.partner.bank", "ir.config_parameter", "hr.employee", "res.partner", "account.payment", "ir.attachment"]) {
      await expect(client.executeKw(m, "search_read", [[]])).rejects.toThrow(/not allowed/);
    }
    expect(sent).toEqual(["common.authenticate"]);
  });

  it("res.users: the connected user's own record only", async () => {
    const { sent, client } = recorder();
    await client.authenticate();
    await expect(client.executeKw("res.users", "search_read", [[]])).rejects.toThrow(/other Odoo users/);
    await expect(client.executeKw("res.users", "read", [[1]])).rejects.toThrow(/other Odoo users/);
    await expect(client.executeKw("res.users", "read", [[7, 1]])).rejects.toThrow(/other Odoo users/);
    await client.executeKw("res.users", "read", [[7]], { fields: ["name"] });
    expect(sent).toEqual(["common.authenticate", "res.users.read"]);
  });

  it("rights questions: only create/write/unlink on accounting models, never raising, never on records", async () => {
    const { sent, client } = recorder(() => false);
    await client.authenticate();
    await expect(client.executeKw("res.partner", "check_access_rights", ["write"], { raise_exception: false })).rejects.toThrow(/not allowed/);
    await expect(client.executeKw("account.move", "check_access_rights", ["read"], { raise_exception: false })).rejects.toThrow(/not allowed/);
    await expect(client.executeKw("account.move", "check_access_rights", ["write"])).rejects.toThrow(/not allowed/);
    await expect(client.executeKw("account.move", "has_access", [[5], "write"])).rejects.toThrow(/not allowed/);
    await client.executeKw("account.move", "check_access_rights", ["write"], { raise_exception: false });
    await client.executeKw("account.move", "has_access", [[], "unlink"]);
    expect(sent).toEqual(["common.authenticate", "account.move.check_access_rights", "account.move.has_access"]);
  });
});

describe("the connection itself", () => {
  it("can be switched off for the whole server", async () => {
    process.env.ODOO_SYNC_DISABLED = "1";
    const { sent, client } = recorder();
    await expect(client.version()).rejects.toThrow(/switched off/);
    expect(sent).toEqual([]);
  });

  it("an answer that is not JSON is refused (a login or proxy page is not Odoo)", async () => {
    const c = new OdooClient("https://x.odoo.com", "db", "me", "secret", (async () => new Response("{\"result\":1}", { headers: { "content-type": "text/html" } })) as typeof fetch);
    await expect(c.version()).rejects.toThrow(/not JSON/);
  });

  it("past its deadline the client sends nothing more", async () => {
    let n = 0;
    const c = new OdooClient("https://x.odoo.com", "db", "me", "secret", (async () => { n++; return new Response("{\"result\":7}", { headers: { "content-type": "application/json" } }); }) as typeof fetch, 25_000, Date.now() - 1);
    await expect(c.authenticate()).rejects.toThrow(/too long.*nothing was saved/);
    expect(n).toBe(0);
  });

  it("an old-style IPv6 address that embeds a private one is refused", async () => {
    const { isPrivateAddress } = await import("@/lib/odoo/net");
    expect([isPrivateAddress("::10.0.0.1"), isPrivateAddress("fec0::1"), isPrivateAddress("2a00:1450::1")]).toEqual([true, true, false]);
  });

  it("only the standard https port", async () => {
    const pub = async () => [{ address: "8.8.8.8", family: 4 }];
    await expect(resolvePublicOdoo("https://x.odoo.com:8443", pub as never)).rejects.toThrow(/port/);
    await expect(resolvePublicOdoo("https://x.odoo.com:443/odoo", pub as never)).resolves.toMatchObject({ url: "https://x.odoo.com" });
  });

  it("the API key never appears in an error, even when Odoo echoes it back", async () => {
    const c = new OdooClient("https://x.odoo.com", "db", "me", "s3cr3t-key-123", (async () => new Response(JSON.stringify({ error: { message: "bad", data: { name: "ValueError", message: "Invalid key s3cr3t-key-123 for user me" } } }), { headers: { "content-type": "application/json" } })) as typeof fetch);
    const e = (await c.version().catch((x: OdooError) => x)) as OdooError;
    expect(e).toBeInstanceOf(OdooError);
    expect(`${e.message} ${e.detail ?? ""}`).not.toContain("s3cr3t-key-123");
  });
});

describe("the connected user is proven read-only", () => {
  for (const v of [17, 18] as const) {
    it(`Odoo ${v}: a read-only user passes, with its name and companies`, async () => {
      const f = fakeOdoo(v);
      const p = await probe(new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch));
      expect(p.rights).toBe("read");
      expect(p.canChange).toEqual([]);
      expect(p.user).toEqual({ name: "iReport Reader", companies: [1] });
    });
  }

  it("a user who can change journal entries is named as such", async () => {
    const p = await probe(new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", fakeOdoo(17, { rights: "write" }).fetch));
    expect(p.rights).toBe("write");
    expect(p.canChange).toContain("account.move");
  });

  it("a Settings admin (can create users) is not read-only, even with read-only accounting", async () => {
    const p = await probe(new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", fakeOdoo(17, { rights: "admin" }).fetch));
    expect(p.rights).toBe("write");
    expect(p.canChange).toEqual(["res.users"]);
  });

  it("when Odoo won't answer the rights question, it is unknown, never assumed safe", async () => {
    const p = await probe(new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", fakeOdoo(17, { rights: "unknown" }).fetch));
    expect(p.rights).toBe("unknown");
  });
});

describe("answers from Odoo are checked before use", () => {
  const tamper = (f: ReturnType<typeof fakeOdoo>, change: (model: string, method: string, body: { result: unknown }) => void) => (async (u: string, init?: RequestInit) => {
    const res = await f.fetch(u, init);
    const body = await res.json();
    const { params } = JSON.parse(String(init?.body));
    if (params.service === "object") change(params.args[3], params.args[4], body);
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  it("an absurd amount stops the sync and is named", async () => {
    const f = fakeOdoo(17);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", tamper(f, (model, method, body) => {
      if (model === "account.move.line" && method === "read_group" && (body.result as unknown[]).length) (body.result as { balance: number }[])[0].balance = 1e18;
    }));
    await expect(syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09" })).rejects.toThrow(/Odoo sent an answer iReport can't trust.*balance/);
  });

  it("an oversized version text is refused, never stored", async () => {
    const f = fakeOdoo(17);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", (async (u: string, init?: RequestInit) => {
      const { params } = JSON.parse(String(init?.body));
      if (params.method === "version") return new Response(JSON.stringify({ result: { server_version: "x".repeat(5000), server_version_info: [17] } }), { headers: { "content-type": "application/json" } });
      return f.fetch(u, init);
    }) as typeof fetch);
    await expect(probe(c)).rejects.toThrow(/can't trust.*version/);
  });

  it("a text where an amount belongs stops the sync", async () => {
    const f = fakeOdoo(17);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", tamper(f, (model, method, body) => {
      if (model === "account.move.line" && method === "read_group" && (body.result as unknown[]).length) (body.result as { balance: unknown }[])[0].balance = "12,000";
    }));
    await expect(syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09" })).rejects.toThrow(/can't trust/);
  });

  it("an account name is trimmed to a safe length", async () => {
    const f = fakeOdoo(17);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", tamper(f, (model, method, body) => {
      if (model === "account.account") (body.result as { name: string }[])[0].name = "x".repeat(5000);
    }));
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09" });
    expect(Math.max(...res.accounts.map((a) => a.name.length))).toBeLessThanOrEqual(256);
  });
});

describe("when a connection may be saved", async () => {
  const { connectionVerdict, atLeast } = await import("@/lib/odoo/policy");
  const base = { rights: "read" as const, canChange: [], user: { name: "iReport Reader", companies: [1] }, companies: [{ id: 1, name: "Sample Trading Co", currency: "EGP" }, { id: 2, name: "Other Co", currency: "EGP" }] };

  it("a read-only user of exactly the chosen company is accepted, with no warning", () => {
    expect(connectionVerdict(base, 1, false)).toMatchObject({ ok: true, warnings: [] });
  });
  it("any user with API access may connect: one who can change accounting data is accepted, with a warning", () => {
    const v = connectionVerdict({ ...base, rights: "write", canChange: ["account.move"] }, 1, false);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/can change accounting data \(account\.move\).*only reads/);
  });
  it("unconfirmed rights are accepted, with a warning", () => {
    const v = connectionVerdict({ ...base, rights: "unknown" }, 1, false);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/did not confirm/);
  });
  it("a user who can see other companies is accepted, naming them in a warning", () => {
    const v = connectionVerdict({ ...base, user: { name: "x", companies: [1, 2] } }, 1, false);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(" ")).toMatch(/also see Other Co/);
  });
  it("a company the user can't see is still refused (nothing could be read from it)", () => {
    expect(connectionVerdict(base, 2, false).ok).toBe(false);
  });
  it("roles: admin ≥ editor ≥ viewer; no role is nothing", () => {
    expect([atLeast("admin", "admin"), atLeast("editor", "admin"), atLeast("editor", "editor"), atLeast("viewer", "editor"), atLeast(null, "viewer")]).toEqual([true, false, true, false, false]);
  });
});

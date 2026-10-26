// The Odoo API key is stored encrypted. When the server has no key, the message names the deployment it ran on, so a
// key added for Production only is easy to tell apart from one missing everywhere.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { decrypt, encrypt } from "@/lib/crypto";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

describe("encryption key", () => {
  it("with no key on a preview deployment, the message names preview and its branch", () => {
    delete process.env.ENCRYPTION_KEY;
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_COMMIT_REF = "claude/sharp-pasteur-ms9hn6";
    expect(() => encrypt("x")).toThrow(/not set for this deployment \(preview, branch claude\/sharp-pasteur-ms9hn6\).*Preview/);
  });

  it("with no key outside Vercel, the message still says how to set it", () => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_GIT_COMMIT_REF;
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it("a 32-byte key encrypts and decrypts", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(decrypt(encrypt("secret"))).toBe("secret");
  });
});

describe("a key is bound to where it was saved", () => {
  const where = (url: string) => `company-1\n${url}\ndb\nme@x`;
  it("decrypts only with the same binding: a copy pointed at another server fails", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const t = encrypt("odoo-key", where("https://a.odoo.com"));
    expect(t.startsWith("v3.k1.")).toBe(true);
    expect(decrypt(t, where("https://a.odoo.com"))).toBe("odoo-key");
    expect(() => decrypt(t, where("https://evil.example"))).toThrow();
    expect(() => decrypt(t, "company-2\nhttps://a.odoo.com\ndb\nme@x")).toThrow();
  });
  it("an unbound (older) value is refused where a binding is required", () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(() => decrypt(encrypt("odoo-key"), where("https://a.odoo.com"))).toThrow(/again/);
  });
});

describe("keys can be rotated", () => {
  const k1 = Buffer.alloc(32, 1).toString("base64"), k2 = Buffer.alloc(32, 2).toString("base64");
  it("a key ring encrypts with its first key and names it; older keys still decrypt", async () => {
    process.env.ENCRYPTION_KEY = k1;
    const old = encrypt("odoo-key", "here");
    process.env.ENCRYPTION_KEYS = `k2:${k2},k1:${k1}`;
    const now = encrypt("odoo-key", "here");
    expect(now.startsWith("v3.k2.")).toBe(true);
    expect(decrypt(now, "here")).toBe("odoo-key");
    expect(decrypt(old, "here")).toBe("odoo-key");
    const { reencrypt } = await import("@/lib/crypto");
    expect(reencrypt(old, "here").startsWith("v3.k2.")).toBe(true);
    expect(() => decrypt(now, "elsewhere")).toThrow();
  });
  it("a value under a key no longer in the ring says so", () => {
    process.env.ENCRYPTION_KEYS = `k2:${k2}`;
    const t = encrypt("x", "a");
    process.env.ENCRYPTION_KEYS = `k3:${k1}`;
    expect(() => decrypt(t, "a")).toThrow(/key k2/);
  });
});

describe("which saved keys still use an old encryption key", () => {
  const k1 = Buffer.alloc(32, 1).toString("base64"), k2 = Buffer.alloc(32, 2).toString("base64");
  it("a value under the current key is fine; an older key or format needs re-encrypting", async () => {
    const { usesOldKey } = await import("@/lib/crypto");
    delete process.env.ENCRYPTION_KEYS;
    process.env.ENCRYPTION_KEY = k1;
    const old = encrypt("x", "a");
    expect(usesOldKey(old)).toBe(false);
    process.env.ENCRYPTION_KEYS = `k2:${k2},k1:${k1}`;
    expect(usesOldKey(old)).toBe(true);
    expect(usesOldKey(encrypt("x", "a"))).toBe(false);
    expect(usesOldKey("v2.aa.bb.cc")).toBe(true);
  });
});

describe("key ids", () => {
  it("are lowercase letters and digits, as the database expects", () => {
    process.env.ENCRYPTION_KEYS = `K2:${Buffer.alloc(32, 2).toString("base64")}`;
    expect(() => encrypt("x", "a")).toThrow(/ENCRYPTION_KEYS/);
    delete process.env.ENCRYPTION_KEYS;
  });
});


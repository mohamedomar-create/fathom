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

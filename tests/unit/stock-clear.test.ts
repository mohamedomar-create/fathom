// The ledger's stock postings are cleared by one server-side call (0051), never row by row from the API.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { REQUIRED_SCHEMA } = await import("@/lib/schema");

const src = readFileSync("src/lib/company/ledger-lines.ts", "utf8");

describe("D1: clearing stock postings", () => {
  it("goes through clear_stock_ledger, and the app needs database update 51", () => {
    expect(src).toContain('rpc("clear_stock_ledger"');
    expect(REQUIRED_SCHEMA).toBeGreaterThanOrEqual(51);
  });
  it("never deletes stock_ledger_lines through the API", () => {
    expect(src).not.toMatch(/from\(t\.lines\)\.delete\(\)[^;]*stock/);
    expect(/kind === "stock"[\s\S]{0,200}clear_stock_ledger/.test(src)).toBe(true);
  });
});

// The full company export must read balances the fast way (company_balances, one membership check),
// never page through account_balances row by row: that read timed out (57014) on CI and on large companies.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/app/api/export/[companyId]/route.ts", "utf8");

describe("company export reads balances in one call", () => {
  it("never reads account_balances directly", () => {
    expect(src).not.toMatch(/from\(\s*["']account_balances["']\s*\)/);
  });
  it("uses loadBalances", () => {
    expect(src).toMatch(/import\s*\{[^}]*\bloadBalances\b[^}]*\}\s*from\s*["']@\/lib\/company\/balances["']/);
    expect(src).toMatch(/loadBalances\(\s*supabase/);
  });
});

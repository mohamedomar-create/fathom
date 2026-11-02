// The full company export must read balances the fast way (company_balances, one membership check),
// never page through account_balances row by row: that read timed out (57014) on CI and on large companies.
// Its lines are read from where the last page stopped, never with an ever-growing offset (D5).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/app/api/export/[companyId]/route.ts", "utf8");
const part = readFileSync("src/app/api/export/[companyId]/part/route.ts", "utf8");
const parts = readFileSync("src/lib/export/parts.ts", "utf8");

describe("company export reads balances in one call", () => {
  it("never reads account_balances directly", () => {
    for (const src of [route, part, parts]) expect(src).not.toMatch(/from\(\s*["']account_balances["']\s*\)/);
  });
  it("uses loadBalances", () => {
    expect(parts).toMatch(/import\s*\{[^}]*\bloadBalances\b[^}]*\}\s*from\s*["']@\/lib\/company\/balances["']/);
    expect(parts).toMatch(/loadBalances\(\s*supabase/);
    expect(route).toMatch(/loadExportMeta\(\s*supabase/);
    expect(part).toMatch(/loadExportMeta\(\s*supabase/);
  });
  it("reads lines by id, never by offset", () => {
    for (const src of [route, part]) expect(src).not.toMatch(/\.range\(/);
  });
});

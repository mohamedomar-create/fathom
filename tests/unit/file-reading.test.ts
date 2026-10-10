import { describe, expect, it } from "vitest";
import type { RawLine } from "@/lib/ingest/extract";
import { dropParentAccounts } from "@/lib/ingest/hierarchy";
import { csvCells, decodeText, fillMerges } from "@/lib/ingest/read";

const buf = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;

describe("reading text files", () => {
  it("decodes UTF-8, UTF-16 with and without a byte-order mark, and Windows Arabic", () => {
    const text = "الحساب,التاريخ\n4101 مبيعات,31/01/2026";
    expect(decodeText(buf(new TextEncoder().encode("﻿" + text)))).toBe(text);
    const le = new Uint8Array(text.length * 2);
    for (let i = 0; i < text.length; i++) { le[i * 2] = text.charCodeAt(i) & 255; le[i * 2 + 1] = text.charCodeAt(i) >> 8; }
    expect(decodeText(buf(Uint8Array.from([0xff, 0xfe, ...le])))).toBe(text);
    expect(decodeText(buf(le))).toBe(text);
    // "مبيعات" in code page 1256
    expect(decodeText(buf(Uint8Array.from([0xe3, 0xc8, 0xed, 0xda, 0xc7, 0xca, 0x20, 0xe3, 0xc8, 0xed, 0xda, 0xc7, 0xca, 0x20, 0xe3, 0xc8, 0xed, 0xda, 0xc7, 0xca, 0x20, 0xe3, 0xc8, 0xed, 0xda, 0xc7, 0xca])))).toContain("مبيعات");
  });

  it("keeps CSV dates and codes as written, and numbers as numbers", () => {
    expect(csvCells([["03/04/2026", "1234.5", "0012", "", "1,234.50"]])).toEqual([["03/04/2026", 1234.5, "0012", null, "1,234.50"]]);
    // A file writing 1.234,50 means "1.234" is a thousand, so it stays text for the sheet's decimal reading.
    expect(csvCells([["1.234", "1.234,50", "2.500,00"]])[0][0]).toBe("1.234");
  });

  it("copies merged headings into the cells they cover, never into rows with amounts", () => {
    const rows = fillMerges([["Code", "Opening", null], [null, "Debit", "Credit"], ["Name", 10, null]], [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, { s: { r: 0, c: 1 }, e: { r: 0, c: 2 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
    ]);
    expect(rows).toEqual([["Code", "Opening", "Opening"], ["Code", "Debit", "Credit"], ["Name", 10, null]]);
  });
});

describe("parent accounts printed with codes", () => {
  const line = (code: string, v: number, opening = 0): RawLine => ({ key: code, sheet: "TB", row: 0, label: code, code, name: `n${code}`, section: "", stmt: null, kind: "movement", values: { "2026-01": v }, opening });

  it("drops a parent equal to its sub-accounts and keeps the accounts", () => {
    const { lines, parents } = dropParentAccounts([line("1", 30, 5), line("11", 30, 5), line("1101", 10, 2), line("1102", 20, 3)]);
    expect(parents.map((p) => p.code)).toEqual(["1", "11"]);
    expect(lines.map((l) => [l.code, l.section])).toEqual([["1101", "n1 / n11"], ["1102", "n1 / n11"]]);
  });

  it("keeps a coded line that does not add up to the lines under it", () => {
    expect(dropParentAccounts([line("11", 99), line("1101", 10), line("1102", 20)]).parents).toEqual([]);
  });

  it("reads dashed codes by segment: 1-1 is the parent of 1-1-01, not of 1-10", () => {
    const { parents } = dropParentAccounts([line("1-1", 10), line("1-1-01", 10), line("1-10", 5)]);
    expect(parents.map((p) => p.code)).toEqual(["1-1"]);
  });
});

// The server reads a job's stored files and sends their rows itself, so the page can be closed once the files are
// uploaded (spec WS1). A run cut short is continued with only the rows the database does not hold.
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { stageJobOnServer, type StageDb } from "@/lib/imports/server-stage";

async function xlsx(rows: (string | number)[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Sheet1").addRows(rows);
  const b = Buffer.from(await wb.xlsx.writeBuffer());
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}
const VAL = [["ID", "Created on", "Product", "Quantity", "Reference", "Total Value"], ...Array.from({ length: 1200 }, (_, i) => [i + 1, "2026-09-02", "[P1] Mask", 1, `WH/IN/${i + 1}`, 100])];

function fakeDb(file: ArrayBuffer, held: [number, number][] = []) {
  const staged: number[] = [];
  const calls: string[] = [];
  const db: StageDb = {
    job: async () => ({ id: "j1", status: "preparing", options: { rentalLocation: null, asOf: "2026-10-15" }, files: [{ id: "f1", filename: "svl.xlsx", export_key: "stock.valuation.layer", storage_path: "c/j1/svl.xlsx", stored: true }] }),
    download: async () => file,
    rpc: async (fn, args) => {
      calls.push(fn);
      if (fn === "import_held") return held;
      if (fn === "stage_import_rows") { for (const r of args.p_rows as { n: number }[]) staged.push(r.n); return (args.p_rows as unknown[]).length; }
      if (fn === "queue_import_job") return null;
      throw new Error("unexpected " + fn);
    },
  };
  return { db, staged, calls };
}

describe("reading and sending a job's rows on the server", () => {
  it("stages every row of every stored file, then hands the job to the database", async () => {
    const f = fakeDb(await xlsx(VAL));
    const r = await stageJobOnServer(f.db, "j1", {});
    expect(f.staged.length).toBe(1200);
    expect(new Set(f.staged).size).toBe(1200);
    expect(f.calls.at(-1)).toBe("queue_import_job");
    expect(r).toEqual({ files: 1, rows: 1200, sent: 1200 });
  });

  it("a run cut short is continued with only the missing rows", async () => {
    const f = fakeDb(await xlsx(VAL), [[1, 1000]]);
    const r = await stageJobOnServer(f.db, "j1", {});
    expect(f.staged).toEqual(Array.from({ length: 200 }, (_, i) => 1001 + i));
    expect(r.sent).toBe(200);
  });

  it("a dropped connection (Node's \"fetch failed\") is tried again, on every call", async () => {
    const f = fakeDb(await xlsx(VAL));
    const rpc = f.db.rpc;
    const failed = new Set<string>();
    f.db.rpc = async (fn, args) => {
      if (!failed.has(fn)) { failed.add(fn); throw new Error("TypeError: fetch failed"); }
      return rpc(fn, args);
    };
    const r = await stageJobOnServer(f.db, "j1", {}, undefined, async () => undefined);
    expect(r.sent).toBe(1200);
    expect(f.calls.at(-1)).toBe("queue_import_job");
  });

  it("a job no longer being prepared is left alone", async () => {
    const f = fakeDb(await xlsx(VAL));
    f.db.job = async () => ({ id: "j1", status: "queued", options: {}, files: [] });
    await expect(stageJobOnServer(f.db, "j1", {})).rejects.toThrow(/no longer open/);
    expect(f.staged).toEqual([]);
  });
});

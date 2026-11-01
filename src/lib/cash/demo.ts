import type { CashCompany, StoredEntry } from "./load";
import { detectKind } from "./kinds";

/**
 * The public cash book demo (/demo/cash): a made-up corner kiosk, twelve full months up to the month before "today",
 * the same every time. Read-only; nothing here is real.
 */
const r2 = (v: number) => Math.round(v * 100) / 100;
const idx = (p: string) => +p.slice(0, 4) * 12 + +p.slice(5, 7) - 1;
const per = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
const dim = (p: string) => new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7), 0)).getUTCDate();

export function demoCashCompany(today: string): CashCompany {
  const first = per(idx(today.slice(0, 7)) - 12);
  return {
    id: "demo", name: "Corner Kiosk (demo)", currency: "EGP", role: "viewer", readOnly: true, simple: true,
    openingCash: { amount: 20000, asOf: `${per(idx(first) - 1)}-${String(dim(per(idx(first) - 1))).padStart(2, "0")}` },
    today, columns: {}, base: "/demo/cash",
  };
}

export function demoCashEntries(today: string): StoredEntry[] {
  const out: StoredEntry[] = [];
  let id = 1;
  const last = idx(today.slice(0, 7)) - 1;
  const add = (day: string, direction: "in" | "out", amount: number, category: string, party = "", paid: boolean | null = true) =>
    out.push({ id: id++, day, direction, amount: r2(amount), category, party, note: "", paid, paidOn: paid ? day : null, source: "app", upload: null, kind: detectKind(direction, `${category} ${party}`), edited: false });
  for (let i = last - 11; i <= last; i++) {
    const p = per(i), m = i % 12, season = 1 + 0.15 * Math.sin(((m + 3) / 12) * 2 * Math.PI), days = dim(p);
    for (let d = 1; d <= days; d += 3) {
      const day = `${p}-${String(d).padStart(2, "0")}`;
      add(day, "in", 2400 * season + ((d * 37 + m * 11) % 400), "Sales");
    }
    add(`${p}-05`, "out", 4000, "Rent", "Landlord");
    add(`${p}-10`, "out", 6000 * season, "Stock purchases", "Wholesaler");
    add(`${p}-20`, "out", 4500 * season, "Stock purchases", "Wholesaler");
    add(`${p}-25`, "out", 6000, "Salaries", "Staff");
    add(`${p}-15`, "out", 900 + (m % 3) * 150, "Electricity", "Electricity company");
    add(`${p}-28`, "in", 1500 + (m % 4) * 200, "Sales", "Nile Clinic", m % 3 === 0 ? false : true);
  }
  return out;
}

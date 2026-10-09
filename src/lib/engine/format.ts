/** Number formatting that mirrors the reference Python engine exactly (so text output matches). */
const MONTH_ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtCache = new Map<number, Intl.NumberFormat>();
function grouped(v: number, d: number): string {
  let f = fmtCache.get(d);
  if (!f) {
    f = new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: true });
    fmtCache.set(d, f);
  }
  return f.format(v);
}

export function money(v: number | null | undefined, cur = "$", short = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const neg = v < 0;
  const a = Math.abs(v);
  let s: string;
  if (short) s = a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${grouped(a / 1e3, 0).replace(/,/g, "")}K` : grouped(a, 0).replace(/,/g, "");
  else s = grouped(a, 0);
  if (s === "0" || s === "0K" || s === "0.0M") return `${cur} ${s}`;
  return (neg ? "-" : "") + `${cur} ` + s;
}

export function pct(v: number | null | undefined, d = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (Math.abs(v) < 0.5 * 10 ** -d) v = 0;
  let s = grouped(v, d);
  if (d) s = s.replace(/0+$/, "").replace(/\.$/, "");
  if (s === "-0") s = "0";
  return s + "%";
}

export type Unit = "cur" | "%" | "days" | "times" | "ratio" | "num";

export function num(v: number | null | undefined, unit: Unit, cur = "$"): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  if (unit === "cur") return money(v, cur);
  if (unit === "%") return pct(v);
  if (unit === "days") return `${grouped(v, 0)} days`;
  if (unit === "times") return `${grouped(v, 1)} times`.replace(".0 times", " times");
  if (unit === "ratio") return `${grouped(v, 2)}:1`.replace(".00:1", ":1");
  return grouped(v, 2);
}

/** Python-style fixed decimals: f"{v:.1f}" */
export function fixed(v: number, d: number): string {
  const s = v.toFixed(d);
  return s === `-${(0).toFixed(d)}` ? (0).toFixed(d) : s;
}

export function div(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
  return a / b;
}

export const parsePeriod = (p: string) => {
  const [y, m] = p.split("-").map(Number);
  return { y, m };
};
export const mlabel = (p: string) => {
  const { y, m } = parsePeriod(p);
  return `${MONTH_ABBR[m]} ${y}`;
};
export const mshort = (p: string) => {
  const { y, m } = parsePeriod(p);
  return `${MONTH_ABBR[m]} ${String(y).slice(2)}`;
};
export const daysIn = (p: string) => {
  const { y, m } = parsePeriod(p);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
export const monthIndex = (p: string) => {
  const { y, m } = parsePeriod(p);
  return y * 12 + m - 1;
};
export const periodFromIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
export const addMonths = (p: string, n: number) => periodFromIndex(monthIndex(p) + n);
export { MONTH_ABBR };

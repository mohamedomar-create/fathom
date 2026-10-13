import sample from "../../../reference/sample.json";
import { summariseSales, type SalesData } from "@/lib/engine";

/**
 * Invoice lines for the demo company, made up but consistent: each month's lines add up exactly to that month's revenue in
 * the demo P&L, and their cost to its variable cost of sales, so the Sales pages reconcile like a real company's.
 */
const CATEGORIES: [string, [string, number, number][]][] = [
  ["Respiratory Devices", [["Oxygen Concentrator 5L", 21000, 0.62], ["Oxygen Concentrator 10L", 34000, 0.6], ["CPAP Machine", 26000, 0.58], ["BiPAP Machine", 41000, 0.57]]],
  ["Patient Monitoring", [["Pulse Oximeter", 1800, 0.45], ["Patient Monitor 7-inch", 28000, 0.55], ["Blood Pressure Monitor", 2400, 0.5]]],
  ["Consumables", [["Nasal Cannula (box of 50)", 1500, 0.4], ["Full Face Mask", 2600, 0.42], ["Humidifier Chamber", 900, 0.38], ["Bacterial Filter (box of 25)", 1250, 0.4]]],
  ["Mobility", [["Wheelchair Standard", 6500, 0.6], ["Hospital Bed Electric", 38000, 0.63], ["Anti-Decubitus Mattress", 7800, 0.55]]],
  ["Service", [["Annual Maintenance Contract", 12000, 0.25], ["Device Rental (month)", 3500, 0.2]]],
];
const CUSTOMERS = [
  "Northside Hospital", "Riverside Clinic", "Green Valley Pharmacy", "Central Care Centre", "Lakeside Medical", "Hilltop Hospital", "Sunrise Home Care",
  "Harbour Clinic", "Oasis Medical Centre", "Palm Grove Pharmacy", "Eastgate Hospital", "Westfield Clinic", "Old Town Pharmacy", "Garden City Clinic",
  "New Cairo Home Care", "Seaside Medical", "Crescent Hospital", "Meadow Pharmacy", "Summit Clinic", "Bridge Care Centre", "Delta Rehab Centre", "Canal Clinic",
  "Pyramid Pharmacy", "Lotus Home Care", "Cedar Medical", "Orchard Clinic",
];
const SALESPEOPLE = ["Sara M.", "Omar K.", "Nour H."];

let cache: SalesData | null = null;

export function demoSales(): SalesData {
  if (cache) return cache;
  let seed = 20260913;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const products = CATEGORIES.flatMap(([category, ps]) => ps.map(([product, price, costRatio]) => ({ category, product, price, costRatio })));
  type L = { period: string; doc: string; series: string; customer: string; product: string; category: string; salesperson: string; qty: number; amount: number; cost: number };
  const lines: L[] = [];
  let n = 0;
  for (const m of sample.months) {
    const revenue = m.pl.revenue ?? 0, varCos = m.pl.cos_variable ?? 0;
    if (!revenue) continue;
    const month: L[] = [];
    let raw = 0;
    while (raw < revenue * 0.97) {
      const doc = `INV/${m.period.slice(0, 4)}/${String(++n).padStart(4, "0")}`;
      // Bigger customers buy more often: a skewed pick keeps the top few at a realistic share.
      const customer = CUSTOMERS[Math.floor(Math.pow(rnd(), 1.8) * CUSTOMERS.length)];
      const salesperson = SALESPEOPLE[Math.floor(rnd() * SALESPEOPLE.length)];
      for (let k = 0, items = 1 + Math.floor(rnd() * 3); k < items; k++) {
        const p = products[Math.floor(Math.pow(rnd(), 1.3) * products.length)];
        const qty = 1 + Math.floor(rnd() * (p.price < 3000 ? 12 : 3));
        const amount = Math.round(qty * p.price * (0.92 + rnd() * 0.16));
        month.push({ period: m.period, doc, series: "INV", customer, product: p.product, category: p.category, salesperson, qty, amount, cost: amount * p.costRatio });
        raw += amount;
      }
    }
    // Scale to the P&L exactly (to the cent), the last line taking the rounding.
    const scale = revenue / raw, costRaw = month.reduce((s, l) => s + l.cost, 0), costScale = costRaw ? varCos / costRaw : 0;
    let a = 0, c = 0;
    month.forEach((l, i) => {
      const last = i === month.length - 1;
      l.amount = last ? Math.round((revenue - a) * 100) / 100 : Math.round(l.amount * scale * 100) / 100;
      l.cost = last ? Math.round((varCos - c) * 100) / 100 : Math.round(l.cost * costScale * 100) / 100;
      a += l.amount; c += l.cost;
    });
    lines.push(...month);
  }
  cache = summariseSales(lines, "file");
  return cache;
}

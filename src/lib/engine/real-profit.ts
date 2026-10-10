import type { Basis } from "./basis";

/**
 * Reported profit against the profit the owners really earned, after the time customers take to pay,
 * inflation and the pound's devaluation. Method (simplified IAS 29, financial capital maintenance):
 *  - money held or owed loses or gains purchasing power: average balance × inflation over the period;
 *  - stock sold was bought earlier at lower prices: replacing it costs cost of sales × the price rise over the stock days
 *    (imported stock rises with the exchange rate, local stock with inflation);
 *  - depreciation is on historical cost: at today's prices it is depreciation × the price rise since the assets were bought.
 * Every amount uses only the figures in the books and the rates the user enters.
 */

export interface Assumptions {
  /** Annual consumer-price inflation, % (CAPMAS urban headline, year on year). */
  inflation?: number | null;
  /** EGP per USD at the start and at the end of the twelve months (CBE rates). */
  fxStart?: number | null;
  fxEnd?: number | null;
  /** Share of stock that is imported, %. */
  importShare?: number | null;
  /** Average age of fixed assets, years. */
  assetAge?: number | null;
  /** Annual borrowing rate, %. */
  rate?: number | null;
  /** Loan principal due over the next 12 months. */
  principal12m?: number | null;
  /** Years over which a new loan would be repaid. */
  tenor?: number | null;
  /** The figures are examples (demo company), not the user's own. */
  example?: boolean;
}

export interface BridgeStep { key: string; label: string; value: number; explain: string }

export interface RealProfit {
  reported: number;
  /** Operating cash flow for the months covered. */
  cashProfit: number | null;
  collection: {
    revenue: number;
    collected: number | null;
    rate: number | null;
    /** Growth in receivables: profit booked but still with customers. */
    stuck: number | null;
    dso: number | null;
    avgAR: number;
    /** Interest a year on the money customers hold, at the borrowing rate. */
    creditCost: number | null;
    /** Cost of one extra day of DSO a year, at the borrowing rate. */
    perDay: number | null;
    targetDso: number;
    /** Cash released by bringing DSO down to the target, and the interest it saves a year. */
    release: number | null;
    saving: number | null;
  };
  /** Null until an inflation rate is entered. */
  inflation: null | {
    periodRate: number;
    steps: BridgeStep[];
    real: number;
    /** Return on opening equity, annual, nominal and after inflation. */
    roe: number | null;
    realRoe: number | null;
    /** Profit needed just to keep the owners' equity at today's prices. */
    keepUp: number | null;
  };
  /** Null until both exchange rates are entered. */
  fx: null | {
    devaluation: number;
    annualDevaluation: number;
    reportedUsd: number;
    realUsd: number | null;
    equityStartUsd: number | null;
    equityEndUsd: number;
    equityChangeUsd: number | null;
  };
}

const pos = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function realProfit(b: Basis, a: Assumptions = {}, cur = "EGP", targetDso = 45): RealProfit {
  const { P, B, B0 } = b;
  const yr = b.days / 365;
  const R = P.revenue;
  const avgAR = b.avg("ar");
  const dso = R > 0 ? (avgAR / R) * b.days : null;
  const rate = pos(a.rate) === null ? null : a.rate! / 100;
  const stuck = B0 ? B.ar - B0.ar : null;
  const daily = R > 0 ? R / b.days : null;
  const release = dso !== null && daily !== null && dso > targetDso ? (dso - targetDso) * daily : null;
  const collection: RealProfit["collection"] = {
    revenue: R, collected: stuck === null ? null : R - stuck, rate: stuck === null || R <= 0 ? null : ((R - stuck) / R) * 100,
    stuck, dso, avgAR,
    creditCost: rate === null ? null : avgAR * rate * yr,
    perDay: rate === null || daily === null ? null : daily * rate,
    targetDso, release, saving: release === null || rate === null ? null : release * rate,
  };

  const pi = pos(a.inflation) === null ? null : a.inflation! / 100;
  const fx0 = pos(a.fxStart), fx1 = pos(a.fxEnd);
  const devaluation = fx0 && fx1 ? fx1 / fx0 - 1 : null;
  const annualDev = devaluation === null ? null : Math.pow(1 + devaluation, 1 / yr) - 1;

  let inflation: RealProfit["inflation"] = null;
  if (pi !== null) {
    const pp = Math.pow(1 + pi, yr) - 1;
    const pctTxt = (x: number) => `${(x * 100).toFixed(1)}%`;
    const cogs = P.cos - P.cos_depreciation;
    const dio = cogs > 0 ? (b.avg("inventory") / cogs) * b.days : 0;
    const share = Math.min(100, Math.max(0, a.importShare ?? 0)) / 100;
    const localRise = Math.pow(1 + pi, dio / 365) - 1;
    const importRise = annualDev === null ? localRise : Math.pow(1 + annualDev, dio / 365) - 1;
    const stockRise = (1 - share) * localRise + share * importRise;
    const age = pos(a.assetAge) ?? 0;
    const depRise = age ? Math.pow(1 + pi, age) - 1 : 0;
    const debt = b.avg("std") + b.avg("ltd");
    const owed = b.avg("ap") + b.avg("tax_liab") + b.avg("other_cl") + b.avg("other_ncl");
    const steps: BridgeStep[] = [
      { key: "ar", label: "Customers paying later", value: -avgAR * pp,
        explain: `Customers owed ${cur} ${Math.round(avgAR).toLocaleString("en-US")} on average${dso !== null ? ` (${Math.round(dso)} days of sales)` : ""}. Prices rose ${pctTxt(pp)} over the period, so that money buys less when it arrives.` },
      { key: "cash", label: "Cash held", value: -b.avg("cash") * pp,
        explain: `Average cash and bank balances of ${cur} ${Math.round(b.avg("cash")).toLocaleString("en-US")} lost ${pctTxt(pp)} of their purchasing power (less any interest earned, already in profit).` },
      { key: "debt", label: "Borrowing repaid in cheaper pounds", value: debt * pp,
        explain: `Average borrowing of ${cur} ${Math.round(debt).toLocaleString("en-US")} is repaid in money worth ${pctTxt(pp)} less. The interest in profit is the price of this gain.` },
      { key: "owed", label: "Suppliers, taxes and other amounts owed", value: owed * pp,
        explain: `Average amounts owed to suppliers and others of ${cur} ${Math.round(owed).toLocaleString("en-US")} are also settled in cheaper money.` },
      { key: "stock", label: "Replacing the stock sold", value: -cogs * stockRise,
        explain: cogs > 0 ? `Stock is held about ${Math.round(dio)} days. Goods sold were bought at older prices; replacing them costs ${pctTxt(stockRise)} more${share ? ` (${Math.round(share * 100)}% imported, priced with the exchange rate)` : ""}. That part of gross profit must be reinvested just to keep the same stock.` : "No cost of sales in the period." },
      { key: "dep", label: "Depreciation at today's prices", value: -P.da * depRise,
        explain: age ? `Assets about ${age} years old cost ${pctTxt(depRise)} more to replace today, so true depreciation is higher than the books show.` : "Enter the average age of your fixed assets to include this." },
    ];
    const real = P.net_income + steps.reduce((s, x) => s + x.value, 0);
    const roe = B0 && B0.te > 0 ? (Math.pow(1 + P.net_income / B0.te, 1 / yr) - 1) * 100 : null;
    inflation = {
      periodRate: pp * 100, steps, real,
      roe, realRoe: roe === null ? null : ((1 + roe / 100) / (1 + pi) - 1) * 100,
      keepUp: B0 && B0.te > 0 ? B0.te * pp : null,
    };
  }

  let fx: RealProfit["fx"] = null;
  if (fx0 && fx1 && devaluation !== null && annualDev !== null) {
    const avgRate = (fx0 + fx1) / 2;
    fx = {
      devaluation: devaluation * 100, annualDevaluation: annualDev * 100,
      reportedUsd: P.net_income / avgRate,
      realUsd: inflation ? inflation.real / avgRate : null,
      equityStartUsd: B0 ? B0.te / fx0 : null, equityEndUsd: B.te / fx1,
      equityChangeUsd: B0 ? B.te / fx1 - B0.te / fx0 : null,
    };
  }
  return { reported: P.net_income, cashProfit: b.ocf, collection, inflation, fx };
}

import type { Basis } from "./basis";
import { DEFAULT_VAT } from "./kpis";

/**
 * Reported profit against the profit the owners really earned, after the time customers take to pay,
 * inflation and the pound's devaluation. Method (current-cost view in the spirit of IAS 29):
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
  /** The loan or facility the company wants to ask the bank for. */
  requestAmount?: number | null;
  requestType?: RequestType | null;
  requestPurpose?: string | null;
  /** The figures are examples (demo company), not the user's own. */
  example?: boolean;
}

export const REQUEST_TYPES = ["term_loan", "working_capital", "lc_guarantee", "other"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];
export const REQUEST_LABEL: Record<RequestType, string> = {
  term_loan: "Term loan (repaid in instalments)",
  working_capital: "Working-capital line / overdraft",
  lc_guarantee: "Letters of credit or guarantee",
  other: "Other facility",
};

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
    /** Rise in EGP per USD over the period, %. */
    devaluation: number;
    /** Fall in the pound's value in dollars over the period, % (30 → 50 per USD is 40%). */
    poundChange: number;
    annualDevaluation: number;
    reportedUsd: number;
    realUsd: number | null;
    equityStartUsd: number | null;
    equityEndUsd: number;
    equityChangeUsd: number | null;
  };
}

const pos = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

export function realProfit(b: Basis, a: Assumptions = {}, cur = "EGP", targetDso = 45, lang: "en" | "ar" = "en"): RealProfit {
  const { P, B, B0 } = b;
  const ar = lang === "ar";
  const L = (en: string, x: string) => (ar ? x : en);
  const yr = b.days / 365;
  const R = P.revenue;
  const avgAR = b.avg("ar");
  // Receivables net of VAT, as on the KPI and bank pages.
  const dso = R > 0 && avgAR >= 0 ? (avgAR / (1 + Math.max(0, b.vat ?? DEFAULT_VAT)) / R) * b.days : null;
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
    const n = (v: number) => `${cur} ${Math.round(v).toLocaleString("en-US")}`;
    const steps: BridgeStep[] = [
      { key: "ar", label: L("Customers paying later", "العملاء يسددون لاحقًا"), value: -avgAR * pp,
        explain: L(`Customers owed ${n(avgAR)} on average${dso !== null ? ` (${Math.round(dso)} days of sales)` : ""}. Prices rose ${pctTxt(pp)} over the period, so that money buys less when it arrives.`, `العملاء مدينون بمتوسط ${n(avgAR)}${dso !== null ? ` (${Math.round(dso)} يومًا من المبيعات)` : ""}. ارتفعت الأسعار ${pctTxt(pp)} خلال الفترة، فهذه الأموال تشتري أقل عند وصولها.`) },
      { key: "cash", label: L("Cash held", "النقدية المحتفظ بها"), value: -b.avg("cash") * pp,
        explain: L(`Average cash and bank balances of ${n(b.avg("cash"))} lost ${pctTxt(pp)} of their purchasing power (less any interest earned, already in profit).`, `متوسط أرصدة النقدية والبنوك ${n(b.avg("cash"))} فقد ${pctTxt(pp)} من قوته الشرائية (ناقص أي فوائد محققة، مدرجة في الربح بالفعل).`) },
      { key: "debt", label: L("Borrowing repaid in cheaper pounds", "اقتراض يُسدد بجنيهات أرخص"), value: debt * pp,
        explain: L(`Average borrowing of ${n(debt)} is repaid in money worth ${pctTxt(pp)} less. The interest in profit is the price of this gain.`, `متوسط الاقتراض ${n(debt)} يُسدد بأموال تساوي أقل بنسبة ${pctTxt(pp)}. الفوائد في الربح هي ثمن هذا المكسب.`) },
      { key: "owed", label: L("Suppliers, taxes and other amounts owed", "الموردون والضرائب والمبالغ المستحقة الأخرى"), value: owed * pp,
        explain: L(`Average amounts owed to suppliers and others of ${n(owed)} are also settled in cheaper money.`, `متوسط المبالغ المستحقة للموردين وغيرهم ${n(owed)} يُسدد أيضًا بأموال أرخص.`) },
      { key: "stock", label: L("Replacing the stock sold", "إحلال المخزون المباع"), value: -cogs * stockRise,
        explain: cogs > 0 ? L(`Stock is held about ${Math.round(dio)} days. Goods sold were bought at older prices; replacing them costs ${pctTxt(stockRise)} more${share ? ` (${Math.round(share * 100)}% imported, priced with the exchange rate)` : ""}. That part of gross profit must be reinvested just to keep the same stock.`, `يبقى المخزون نحو ${Math.round(dio)} يومًا. البضاعة المباعة اشتُريت بأسعار أقدم؛ وإحلالها يكلف ${pctTxt(stockRise)} أكثر${share ? ` (${Math.round(share * 100)}% مستورد، يتسعر بسعر الصرف)` : ""}. هذا الجزء من مجمل الربح يجب إعادة استثماره فقط للحفاظ على نفس المخزون.`) : L("No cost of sales in the period.", "لا توجد تكلفة مبيعات في الفترة.") },
      { key: "dep", label: L("Depreciation at today's prices", "الإهلاك بأسعار اليوم"), value: -P.da * depRise,
        explain: age ? L(`Assets about ${age} years old cost ${pctTxt(depRise)} more to replace today, so true depreciation is higher than the books show.`, `أصول عمرها نحو ${age} سنوات تكلف ${pctTxt(depRise)} أكثر لإحلالها اليوم، فالإهلاك الحقيقي أعلى مما تظهره الدفاتر.`) : L("Enter the average age of your fixed assets to include this.", "أدخل متوسط عمر أصولك الثابتة لإضافة هذا.") },
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
      devaluation: devaluation * 100, poundChange: (1 - fx0 / fx1) * 100, annualDevaluation: annualDev * 100,
      reportedUsd: P.net_income / avgRate,
      realUsd: inflation ? inflation.real / avgRate : null,
      equityStartUsd: B0 ? B0.te / fx0 : null, equityEndUsd: B.te / fx1,
      equityChangeUsd: B0 ? B.te / fx1 - B0.te / fx0 : null,
    };
  }
  return { reported: P.net_income, cashProfit: b.ocf, collection, inflation, fx };
}

/** Two or three plain sentences on the result, used when no commentary has been written. */
export function realProfitSummary(x: RealProfit, cur: string, lang: "en" | "ar" = "en"): string {
  const m = (v: number) => `${cur} ${Math.round(v).toLocaleString("en-US")}`;
  const out: string[] = [];
  if (lang === "ar") {
    if (x.inflation) {
      const share = x.reported > 0 ? (x.inflation.real / x.reported) * 100 : null;
      out.push(`الربح المعلن ${m(x.reported)} يساوي ${m(x.inflation.real)} بأسعار اليوم${share !== null ? ` (${Math.round(share)}% مما تظهره الدفاتر)` : ""}، بعد تضخم ${x.inflation.periodRate.toFixed(1)}%.`);
      const worst = [...x.inflation.steps].sort((a, b) => a.value - b.value)[0];
      if (worst && worst.value < 0) out.push(`أكبر تآكل هو ${worst.label} (${m(-worst.value)}).`);
      if (x.inflation.realRoe !== null) out.push(x.inflation.realRoe < 0 ? `بالقيمة الحقيقية خسر الملاك ${Math.abs(x.inflation.realRoe).toFixed(1)}% من قيمة حقوق ملكيتهم خلال السنة.` : `حقق الملاك عائدًا حقيقيًا ${x.inflation.realRoe.toFixed(1)}% سنويًا على حقوق ملكيتهم.`);
    } else out.push(`الربح المعلن ${m(x.reported)}؛ أدخل معدل التضخم لترى قيمته بأسعار اليوم.`);
    if (x.collection.release !== null && x.collection.release > 0) out.push(`التحصيل من العملاء في ${Math.round(x.collection.targetDso)} يومًا بدلًا من ${Math.round(x.collection.dso!)} سيحرر ${m(x.collection.release)} من النقدية.`);
    return out.join(" ");
  }
  if (x.inflation) {
    const share = x.reported > 0 ? (x.inflation.real / x.reported) * 100 : null;
    out.push(`Reported profit of ${m(x.reported)} is worth ${m(x.inflation.real)} at today's prices${share !== null ? ` (${Math.round(share)}% of what the books show)` : ""}, after ${x.inflation.periodRate.toFixed(1)}% inflation.`);
    const worst = [...x.inflation.steps].sort((a, b) => a.value - b.value)[0];
    if (worst && worst.value < 0) out.push(`The largest erosion is ${worst.label.toLowerCase()} (${m(-worst.value)}).`);
    if (x.inflation.realRoe !== null) out.push(x.inflation.realRoe < 0 ? `In real terms the owners lost ${Math.abs(x.inflation.realRoe).toFixed(1)}% of their equity's value over the year.` : `Owners earned a real return of ${x.inflation.realRoe.toFixed(1)}% a year on their equity.`);
  } else out.push(`Reported profit is ${m(x.reported)}; enter the inflation rate to see what it is worth at today's prices.`);
  if (x.collection.release !== null && x.collection.release > 0) out.push(`Collecting from customers in ${Math.round(x.collection.targetDso)} days instead of ${Math.round(x.collection.dso!)} would release ${m(x.collection.release)} of cash.`);
  return out.join(" ");
}

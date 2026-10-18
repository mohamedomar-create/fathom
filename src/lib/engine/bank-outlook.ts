import { BANK_LIMITS, bankAssessment, type BankAssessment, type BankInputs, type BankRatio, type LoanAccount } from "./bank";
import { twelveMonths, type Basis } from "./basis";
import { addMonths, mlabel, money, pct } from "./format";
import { REQUEST_LABEL, type Assumptions, type RequestType } from "./real-profit";
import type { MonthData } from "./types";
import { monthLabel } from "@/lib/i18n";

type Lang = "en" | "ar";
const TREND_AR: Record<string, string> = {
  revenue: "الإيرادات", rev_growth: "نمو الإيرادات", ebitda: "الأرباح قبل الفوائد والضرائب والإهلاك", ebitda_margin: "هامش الأرباح قبل الفوائد والضرائب والإهلاك",
  net_income: "صافي الربح", ocf: "التدفق النقدي التشغيلي", debt: "الاقتراض", equity: "حقوق الملكية", dscr: "تغطية خدمة الدين", debt_ebitda: "الديون إلى الأرباح قبل الفوائد والضرائب والإهلاك",
  int_cover: "تغطية الفوائد", current: "نسبة التداول", dso: "أيام التحصيل من العملاء", ccc: "الدورة النقدية",
};
/** The kinds of facility in Arabic (same keys as REQUEST_LABEL). */
export const REQUEST_LABEL_AR: Record<RequestType, string> = {
  term_loan: "قرض لأجل (يُسدد على أقساط)", working_capital: "تسهيل رأس مال عامل / سحب على المكشوف", lc_guarantee: "اعتمادات مستندية أو خطابات ضمان", other: "تسهيل آخر",
};

/** A bank measure as text: 2.29x, 14.8%, 82 days, EGP 1,234. */
export function formatBankValue(r: Pick<BankRatio, "value" | "unit">, cur: string, lang: Lang = "en") {
  const ar = lang === "ar";
  if (r.value === null) return ar ? "غير متاح" : "n/a";
  if (r.unit === "x") return ar ? `${r.value.toFixed(2)} مرة` : `${r.value.toFixed(2)}x`;
  if (r.unit === "%") return pct(r.value, 1);
  if (r.unit === "days") return ar ? `${Math.round(r.value)} يوم` : `${Math.round(r.value)} days`;
  return money(r.value, cur);
}

// ------------------------------------------------------------------ three-year trend

export type Direction = "better" | "worse" | "flat";
export interface TrendRow {
  key: string;
  name: string;
  unit: "cur" | "%" | "x" | "days";
  /** Whether a higher value is better. */
  higher: boolean;
  /** One value per year, oldest first. */
  values: (number | null)[];
  /** Latest year against the one before. */
  direction: Direction | null;
}
export interface TrendYear { label: string; end: string; basis: Basis; assessment: BankAssessment }
export interface YearTrend { years: TrendYear[]; rows: TrendRow[] }

/** Up to three twelve-month periods ending at `end`, a year apart. Earlier years count only when complete (or an annual column). */
export function yearTrend(months: MonthData[], end: string, fyStart: number, inp: BankInputs = {}, cur = "EGP"): YearTrend {
  const held = new Set(months.map((m) => m.period));
  const years: TrendYear[] = [];
  for (let k = 0; k < 3; k++) {
    const e = addMonths(end, -12 * k);
    if (!held.has(e)) break;
    const b = twelveMonths(months, e, fyStart);
    if (k > 0 && b.covered < 12 && !b.annualColumn) break;
    // Repayments for past years always use the estimate: the schedule entered applies to the next 12 months only.
    const a = bankAssessment(b, k === 0 ? inp : { ...inp, principal12m: null }, cur);
    years.unshift({ label: inp.lang === "ar" ? `12 شهرًا حتى ${monthLabel(e, "ar")}` : `12 months to ${mlabel(e)}`, end: e, basis: b, assessment: a });
  }
  const ratio = (key: string) => (y: TrendYear) => y.assessment.ratios.find((r) => r.key === key)?.value ?? null;
  const defs: [string, string, TrendRow["unit"], boolean, (y: TrendYear) => number | null][] = [
    ["revenue", "Revenue", "cur", true, (y) => y.basis.Pa.revenue],
    ["rev_growth", "Revenue growth", "%", true, ratio("rev_growth")],
    ["ebitda", "EBITDA", "cur", true, (y) => y.basis.Pa.ebitda],
    ["ebitda_margin", "EBITDA margin", "%", true, ratio("ebitda_margin")],
    ["net_income", "Net profit", "cur", true, (y) => y.basis.Pa.net_income],
    ["ocf", "Operating cash flow", "cur", true, (y) => (y.basis.ocf === null ? null : y.basis.ocf * y.basis.factor)],
    ["debt", "Borrowing", "cur", false, (y) => y.basis.B.std + y.basis.B.ltd],
    ["equity", "Equity", "cur", true, (y) => y.basis.B.te],
    ["dscr", "Debt service cover", "x", true, ratio("dscr")],
    ["debt_ebitda", "Debt to EBITDA", "x", false, ratio("debt_ebitda")],
    ["int_cover", "Interest cover", "x", true, ratio("int_cover")],
    ["current", "Current ratio", "x", true, ratio("current")],
    ["dso", "Customer days", "days", false, ratio("dso")],
    ["ccc", "Cash cycle", "days", false, ratio("ccc")],
  ];
  const rows = defs.map(([key, name, unit, higher, get]): TrendRow => {
    const values = years.map(get);
    const [prev, last] = values.slice(-2);
    let direction: Direction | null = null;
    if (values.length > 1 && prev !== null && last !== null) {
      const tol = unit === "cur" ? Math.max(1, Math.abs(prev) * 0.01) : unit === "days" ? 1 : unit === "%" ? 0.5 : 0.01;
      direction = Math.abs(last - prev) <= tol ? "flat" : (last > prev) === higher ? "better" : "worse";
    }
    return { key, name: inp.lang === "ar" ? TREND_AR[key] ?? name : name, unit, higher, values, direction };
  });
  return { years, rows };
}

// ------------------------------------------------------------------ stress test

export interface StressShock { sales?: number; ratePts?: number; fx?: number; dsoDays?: number }
export interface StressScenario {
  key: string;
  name: string;
  detail: string;
  revenue: number;
  ebitda: number;
  interest: number;
  dscr: number | null;
  icr: number | null;
  debtEbitda: number | null;
  /** Extra cash tied up (customers paying later). */
  extraCash: number;
  /** pass: cover 1.25x or more; tight: 1.0 to 1.25x; fail: below 1.0x; na: no debt service. */
  band: "pass" | "tight" | "fail" | "na";
}
export interface StressResult {
  scenarios: StressScenario[];
  /** Largest fall in sales (%, 0 to 100) that keeps cover at 1.0x; null when there is no debt service. */
  maxSalesFall: number | null;
  /** Largest rise in interest rates (points) that keeps cover at 1.0x; null when there is no borrowing. */
  maxRateRise: number | null;
  notes: string[];
}
export interface StressInputs { taxRate: number; importShare?: number | null; rate?: number | null; lang?: Lang }

/** Re-runs the year's figures under bank-style shocks. Variable costs move with sales; fixed costs do not; tax follows profit. */
export function stressTest(b: Basis, a: BankAssessment, inp: StressInputs): StressResult {
  const { Pa, B } = b;
  const R = Pa.revenue;
  const share = Math.min(100, Math.max(0, inp.importShare ?? 0)) / 100;
  const rate = inp.rate && inp.rate > 0 ? inp.rate / 100 : a.capacity.rate !== null ? a.capacity.rate / 100 : 0;
  const avgDebt = b.avg("std") + b.avg("ltd");
  const debt = B.std + B.ltd;
  const principal = a.principal12m;
  const run = (s: StressShock) => {
    const dR = R * (s.sales ?? 0);
    const dVar = Pa.variable_costs * (s.sales ?? 0);
    const dFx = (Pa.cos - Pa.cos_depreciation) * (1 + (s.sales ?? 0)) * share * (s.fx ?? 0);
    const extraCash = s.dsoDays ? ((R + dR) / 365) * s.dsoDays : 0;
    const dInt = avgDebt * (s.ratePts ?? 0) / 100 + extraCash * (rate + (s.ratePts ?? 0) / 100);
    const dOp = dR - dVar - dFx;
    const interest = Pa.interest_expenses + dInt;
    const ebitda = Pa.ebitda + dOp;
    const ebit = Pa.ebit + dOp;
    // The same tax as the headline: the charge booked, or the profile rate on the profit when the books carry none.
    const baseTax = Pa.tax_expenses > 0 ? Pa.tax_expenses : Math.max(0, Pa.ebt) * inp.taxRate;
    const tax = Math.max(0, baseTax + inp.taxRate * (dOp - dInt));
    const service = interest + principal;
    const dscr = service > 0 ? (ebitda - tax) / service : null;
    return {
      revenue: R + dR, ebitda, interest, extraCash, dscr,
      icr: interest > 0 ? ebit / interest : null,
      debtEbitda: ebitda > 0 ? (debt + extraCash) / ebitda : null,
    };
  };
  const band = (d: number | null): StressScenario["band"] => (d === null ? "na" : d >= BANK_LIMITS.dscr ? "pass" : d >= BANK_LIMITS.dscrFloor ? "tight" : "fail");
  const notes: string[] = [];
  const ar = inp.lang === "ar";
  const L = (en: string, a: string) => (ar ? a : en);
  const defs: [string, string, string, StressShock][] = [
    ["base", L("As reported", "كما هي"), L("The last 12 months as they are.", "آخر 12 شهرًا كما هي."), {}],
    ["sales10", L("Sales fall 10%", "انخفاض المبيعات 10%"), L("Variable costs fall with sales; fixed costs stay.", "التكاليف المتغيرة تنخفض مع المبيعات؛ والثابتة تبقى."), { sales: -0.1 }],
    ["sales20", L("Sales fall 20%", "انخفاض المبيعات 20%"), L("A severe year: the test most credit committees run.", "سنة صعبة: الاختبار الذي تجريه معظم لجان الائتمان."), { sales: -0.2 }],
    ["rates", L("Interest rates rise 3 points", "ارتفاع أسعار الفائدة 3 نقاط"), L("Egyptian loans mostly float with the Central Bank rate.", "القروض في مصر غالبًا متغيرة مع سعر البنك المركزي."), { ratePts: 3 }],
  ];
  if (share > 0) defs.push(["fx", L("Pound loses 20% against the dollar", "الجنيه يفقد 20% أمام الدولار"), L(`Imported costs (${Math.round(share * 100)}% of cost of sales) rise 25%, before any price increase.`, `التكاليف المستوردة (${Math.round(share * 100)}% من تكلفة المبيعات) ترتفع 25%، قبل أي زيادة في الأسعار.`), { fx: 0.25 }]);
  else notes.push(L("Enter the imported share of stock to include a devaluation scenario.", "أدخل نسبة المخزون المستورد لإضافة سيناريو تخفيض العملة."));
  defs.push(["dso", L("Customers pay 30 days later", "العملاء يسددون بعد 30 يومًا إضافية"), L("The extra receivables are funded by overdraft.", "أرصدة العملاء الإضافية تُموَّل بالسحب على المكشوف."), { dsoDays: 30 }]);
  defs.push(["combined", L("All at once", "كلها معًا"), share > 0 ? L("Sales −10%, rates +3 points, pound −20%, customers 30 days later.", "المبيعات −10%، الفائدة +3 نقاط، الجنيه −20%، العملاء يتأخرون 30 يومًا.") : L("Sales −10%, rates +3 points, customers 30 days later.", "المبيعات −10%، الفائدة +3 نقاط، العملاء يتأخرون 30 يومًا."),
    { sales: -0.1, ratePts: 3, dsoDays: 30, ...(share > 0 ? { fx: 0.25 } : {}) }]);
  if (!rate) notes.push(L("No borrowing rate entered or implied: the cost of funding later customer payments is left out.", "لم يُدخل سعر اقتراض ولا يمكن استنتاجه: تكلفة تمويل تأخر سداد العملاء غير محسوبة."));
  const scenarios = defs.map(([key, name, detail, s]) => { const r = run(s); return { key, name, detail, ...r, band: band(r.dscr) }; });

  const solve = (f: (x: number) => number | null, hi: number) => {
    const at0 = f(0);
    if (at0 === null) return null;
    if (at0 < 1) return 0;
    if ((f(hi) ?? 0) >= 1) return hi;
    let lo = 0, up = hi;
    for (let i = 0; i < 60; i++) { const mid = (lo + up) / 2; if ((f(mid) ?? 0) >= 1) lo = mid; else up = mid; }
    return lo;
  };
  const fall = solve((x) => run({ sales: -x / 100 }).dscr, 100);
  const rise = avgDebt > 0 ? solve((x) => run({ ratePts: x }).dscr, 100) : null;
  return { scenarios, maxSalesFall: fall, maxRateRise: rise, notes };
}

// ------------------------------------------------------------------ the loan being asked for

export interface LoanRequest { amount: number; type: RequestType; purpose?: string | null }
export interface ProForma {
  amount: number;
  type: RequestType;
  /** Yearly payment the new facility adds: instalments for a term loan, interest for a line, none for LCs/guarantees. */
  payment: number | null;
  rate: number | null;
  tenor: number;
  dscrBefore: number | null;
  dscr: number | null;
  debtEbitdaBefore: number | null;
  debtEbitda: number | null;
  icrBefore: number | null;
  icr: number | null;
  /** Meets 1.25x cover and the leverage cap after the loan. */
  fits: boolean | null;
  /** Amount above the estimated room to borrow (0 when within it). */
  excess: number | null;
  /** Shortest whole-year tenor that keeps cover at the target (term loans); null when no tenor works. */
  tenorNeeded: number | null;
}

export function proForma(b: Basis, a: BankAssessment, req: LoanRequest, rateIn?: number | null, tenorIn?: number | null): ProForma {
  const { Pa, B } = b;
  const r = rateIn && rateIn > 0 ? rateIn / 100 : a.capacity.rate !== null ? a.capacity.rate / 100 : null;
  const tenor = tenorIn && tenorIn > 0 ? tenorIn : a.capacity.tenor;
  const funded = req.type !== "lc_guarantee";
  const L = Math.max(0, req.amount);
  const payment = r === null ? (funded ? null : 0)
    : req.type === "term_loan" || req.type === "other" ? (L * r) / (1 - Math.pow(1 + r, -tenor))
    : req.type === "working_capital" ? L * r : 0;
  const newInterest = funded && r !== null ? L * r : 0;
  const { cashForDebt, existingService, targetDscr, maxLeverage } = a.capacity;
  const debt = B.std + B.ltd;
  const dscrBefore = existingService > 0 ? cashForDebt / existingService : null;
  const service = existingService + (payment ?? 0);
  const dscr = payment === null ? null : service > 0 ? cashForDebt / service : null;
  const debtAfter = debt + (funded ? L : 0);
  const debtEbitda = Pa.ebitda > 0 ? debtAfter / Pa.ebitda : null;
  const icr = Pa.interest_expenses + newInterest > 0 ? Pa.ebit / (Pa.interest_expenses + newInterest) : null;
  const spare = cashForDebt / targetDscr - existingService;
  let tenorNeeded: number | null = null;
  if ((req.type === "term_loan" || req.type === "other") && r !== null && spare > 0 && r * L < spare) tenorNeeded = Math.max(1, Math.ceil(-Math.log(1 - (r * L) / spare) / Math.log(1 + r)));
  return {
    amount: L, type: req.type, payment, rate: r === null ? null : r * 100, tenor,
    dscrBefore, dscr, debtEbitdaBefore: Pa.ebitda > 0 ? debt / Pa.ebitda : null, debtEbitda,
    icrBefore: Pa.interest_expenses > 0 ? Pa.ebit / Pa.interest_expenses : null, icr,
    fits: dscr === null ? null : (dscr >= targetDscr || service === 0) && (debtEbitda !== null && debtEbitda <= maxLeverage),
    excess: a.capacity.headroom === null || !funded ? null : Math.max(0, L - a.capacity.headroom),
    tenorNeeded,
  };
}

// ------------------------------------------------------------------ automatic memo

export interface BankMemo { headline: string; lead: string[]; risks: { risk: string; answer: string }[]; ask: string[]; questions: string[] }

/** The bank discussion memo built from the figures alone (no AI): the same shape the AI memo follows. */
export function ruleMemo(name: string, a: BankAssessment, opts: { stress?: StressResult | null; pf?: ProForma | null; trend?: YearTrend | null; cur: string; purpose?: string | null; lang?: Lang }): BankMemo {
  if (opts.lang === "ar") return ruleMemoAr(name, a, opts);
  const { cur } = opts;
  const f = (r: BankRatio) => `${r.name} ${formatBankValue(r, cur)}`;
  const strong = a.strengths.slice(0, 3);
  const high = a.flags.filter((x) => x.severity === "high");
  const concern = a.weaknesses[0]?.name.toLowerCase() ?? high[0]?.title.toLowerCase() ?? a.flags[0]?.title.toLowerCase();
  let headline: string;
  if (!strong.length) headline = `${name}'s figures will make borrowing hard until ${concern ?? "repayment capacity"} improves.`;
  else if (!a.weaknesses.length && !high.length) headline = `${name} is in a strong position to borrow: ${strong.slice(0, 2).map(f).join(" and ")}.`;
  else headline = `${strong.slice(0, 2).map((r) => r.name).join(" and ")} support the application; prepare for questions on ${concern}.`;
  const req = opts.pf;
  if (req && req.amount > 0 && req.fits === false && strong.length)
    headline = `${strong.slice(0, 2).map(f).join(" and ")} are strong, but the ${money(req.amount, cur)} requested goes beyond common limits${a.capacity.headroom !== null && a.capacity.headroom > 0 ? `; the figures support about ${money(a.capacity.headroom, cur)}` : ""}${req.tenorNeeded ? `, or the full amount repaid over ${req.tenorNeeded} years` : ""}.`;

  const lead = strong.map((r) => `${r.name}: ${formatBankValue(r, cur)}. ${r.banker}`);
  const better = opts.trend?.rows.filter((r) => r.direction === "better" && ["revenue", "ebitda", "net_income", "equity", "dscr"].includes(r.key)).map((r) => r.name.toLowerCase()) ?? [];
  if (better.length >= 2) lead.push(`Improving year on year: ${better.join(", ")}.`);
  if (opts.stress?.maxSalesFall !== null && opts.stress?.maxSalesFall !== undefined && opts.stress.maxSalesFall >= 15)
    lead.push(`Resilience: sales could fall ${Math.round(opts.stress.maxSalesFall)}% before cash stops covering loan payments.`);

  const risks = [
    ...high.map((x) => ({ risk: `${x.title} (${x.detail.replace(/\.$/, "")})`, answer: x.advice })),
    ...a.weaknesses.map((r) => ({ risk: `${r.name} ${formatBankValue(r, cur)} against a guide of ${r.guide.toLowerCase()}`, answer: r.advice })),
    ...a.flags.filter((x) => x.severity === "medium").map((x) => ({ risk: `${x.title} (${x.detail.replace(/\.$/, "")})`, answer: x.advice })),
  ].slice(0, 5);

  const ask: string[] = [];
  const pf = opts.pf;
  if (pf && pf.amount > 0) {
    const what = `${money(pf.amount, cur)} ${REQUEST_LABEL[pf.type].toLowerCase()}${opts.purpose ? ` for ${opts.purpose.replace(/\.$/, "")}` : ""}`;
    if (pf.type === "lc_guarantee") ask.push(`Ask for ${what}: a non-cash facility; the bank will look at the margin it holds and your trading record.`);
    else if (pf.fits) ask.push(`Ask for ${what}: cover stays at ${pf.dscr!.toFixed(2)}x and debt at ${pf.debtEbitda!.toFixed(1)}x EBITDA after it.`);
    else if (pf.dscr !== null) ask.push(`${what} takes cover to ${pf.dscr.toFixed(2)}x${pf.debtEbitda !== null ? ` and debt to ${pf.debtEbitda.toFixed(1)}x EBITDA` : ""}, beyond common limits.${pf.tenorNeeded ? ` Repaying over ${pf.tenorNeeded} years would keep cover at ${a.capacity.targetDscr}x.` : ""}${pf.excess ? ` Or ask for ${money(pf.amount - pf.excess, cur)}.` : ""}`);
    else ask.push(`Ask for ${what}. Enter the borrowing rate to test what it does to cover.`);
  } else if (a.capacity.headroom !== null && a.capacity.headroom > 0) ask.push(`These figures support roughly ${money(a.capacity.headroom, cur)} more borrowing${a.capacity.rate !== null ? ` at ${pct(a.capacity.rate, 1)} over ${a.capacity.tenor} years` : ""}.`);
  if (a.ratios.find((r) => r.key === "lt_funding")?.band === "weak") ask.push("Ask to move part of the short-term borrowing to a medium-term loan matched to the assets.");
  if (a.ratios.find((r) => r.key === "dso")?.band !== "strong") ask.push("Ask whether the bank will finance receivables (discounting or factoring) against the ageing list.");

  const questions = a.flags.map((x) => `${x.title}: ${x.detail}`).slice(0, 5);
  return { headline, lead: lead.slice(0, 5), risks, ask, questions };
}

/** The same memo in Arabic, from the same figures and rules. */
function ruleMemoAr(name: string, a: BankAssessment, opts: { stress?: StressResult | null; pf?: ProForma | null; trend?: YearTrend | null; cur: string; purpose?: string | null }): BankMemo {
  const { cur } = opts;
  const v = (r: BankRatio) => formatBankValue(r, cur, "ar");
  const f = (r: BankRatio) => `${r.name} ${v(r)}`;
  const strong = a.strengths.slice(0, 3);
  const high = a.flags.filter((x) => x.severity === "high");
  const concern = a.weaknesses[0]?.name ?? high[0]?.title ?? a.flags[0]?.title;
  let headline: string;
  if (!strong.length) headline = `أرقام ${name} ستجعل الاقتراض صعبًا حتى تتحسن ${concern ?? "القدرة على السداد"}.`;
  else if (!a.weaknesses.length && !high.length) headline = `${name} في موقف قوي للاقتراض: ${strong.slice(0, 2).map(f).join(" و")}.`;
  else headline = `${strong.slice(0, 2).map((r) => r.name).join(" و")} تدعم الطلب؛ استعد لأسئلة حول ${concern}.`;
  const req = opts.pf;
  if (req && req.amount > 0 && req.fits === false && strong.length)
    headline = `${strong.slice(0, 2).map(f).join(" و")} قوية، لكن المبلغ المطلوب ${money(req.amount, cur)} يتجاوز الحدود المعتادة${a.capacity.headroom !== null && a.capacity.headroom > 0 ? `؛ الأرقام تدعم نحو ${money(a.capacity.headroom, cur)}` : ""}${req.tenorNeeded ? `، أو المبلغ كاملًا على ${req.tenorNeeded} سنوات` : ""}.`;
  const lead = strong.map((r) => `${r.name}: ${v(r)}. ${r.banker}`);
  const better = opts.trend?.rows.filter((r) => r.direction === "better" && ["revenue", "ebitda", "net_income", "equity", "dscr"].includes(r.key)).map((r) => TREND_AR[r.key] ?? r.name) ?? [];
  if (better.length >= 2) lead.push(`تحسن عامًا بعد عام: ${better.join("، ")}.`);
  if (opts.stress?.maxSalesFall !== null && opts.stress?.maxSalesFall !== undefined && opts.stress.maxSalesFall >= 15)
    lead.push(`المرونة: يمكن أن تنخفض المبيعات ${Math.round(opts.stress.maxSalesFall)}% قبل أن تتوقف النقدية عن تغطية أقساط القروض.`);
  const risks = [
    ...high.map((x) => ({ risk: `${x.title} (${x.detail.replace(/\.$/, "")})`, answer: x.advice })),
    ...a.weaknesses.map((r) => ({ risk: `${r.name} ${v(r)} مقابل معيار ${r.guide}`, answer: r.advice })),
    ...a.flags.filter((x) => x.severity === "medium").map((x) => ({ risk: `${x.title} (${x.detail.replace(/\.$/, "")})`, answer: x.advice })),
  ].slice(0, 5);
  const ask: string[] = [];
  const pf = opts.pf;
  if (pf && pf.amount > 0) {
    const what = `${REQUEST_LABEL_AR[pf.type]} بمبلغ ${money(pf.amount, cur)}${opts.purpose ? ` لغرض ${opts.purpose.replace(/\.$/, "")}` : ""}`;
    if (pf.type === "lc_guarantee") ask.push(`اطلب ${what}: تسهيل غير نقدي؛ سينظر البنك إلى الهامش المحتجز وسجلك التجاري.`);
    else if (pf.fits) ask.push(`اطلب ${what}: تبقى التغطية ${pf.dscr!.toFixed(2)} مرة والديون ${pf.debtEbitda!.toFixed(1)} مرة من الأرباح قبل الفوائد والضرائب والإهلاك بعده.`);
    else if (pf.dscr !== null) ask.push(`${what} يأخذ التغطية إلى ${pf.dscr.toFixed(2)} مرة${pf.debtEbitda !== null ? ` والديون إلى ${pf.debtEbitda.toFixed(1)} مرة من الأرباح` : ""}، أبعد من الحدود المعتادة.${pf.tenorNeeded ? ` السداد على ${pf.tenorNeeded} سنوات يبقي التغطية عند ${a.capacity.targetDscr} مرة.` : ""}${pf.excess ? ` أو اطلب ${money(pf.amount - pf.excess, cur)}.` : ""}`);
    else ask.push(`اطلب ${what}. أدخل سعر الاقتراض لاختبار أثره على التغطية.`);
  } else if (a.capacity.headroom !== null && a.capacity.headroom > 0) ask.push(`هذه الأرقام تدعم اقتراضًا إضافيًا بنحو ${money(a.capacity.headroom, cur)}${a.capacity.rate !== null ? ` بسعر ${pct(a.capacity.rate, 1)} على ${a.capacity.tenor} سنوات` : ""}.`);
  if (a.ratios.find((r) => r.key === "lt_funding")?.band === "weak") ask.push("اطلب نقل جزء من الاقتراض قصير الأجل إلى قرض متوسط الأجل يتناسب مع الأصول.");
  if (a.ratios.find((r) => r.key === "dso")?.band !== "strong") ask.push("اسأل إن كان البنك سيمول أرصدة العملاء (خصم أو تخصيم) مقابل كشف الأعمار.");
  const questions = a.flags.map((x) => `${x.title}: ${x.detail}`).slice(0, 5);
  return { headline, lead: lead.slice(0, 5), risks, ask, questions };
}

/** The memo as plain text, in the same layout the AI writes (headings, then "• " bullets). */
export function memoText(m: BankMemo, lang: Lang = "en"): string {
  const block = (h: string, items: string[]) => (items.length ? `\n\n${h}\n${items.map((x) => `• ${x}`).join("\n")}` : "");
  const ar = lang === "ar";
  return m.headline
    + block(ar ? "ابدأ بـ" : "Lead with", m.lead)
    + block(ar ? "المخاطر وكيف ترد عليها" : "Risks and how to answer them", m.risks.map((r) => `${r.risk}. ${r.answer}`))
    + block(ar ? "ما الذي تطلبه" : "What to ask for", m.ask)
    + block(ar ? "أسئلة متوقعة" : "Questions to expect", m.questions);
}

// ------------------------------------------------------------------ everything the bank page and report show

export interface BankPack {
  basis: Basis;
  assessment: BankAssessment;
  trend: YearTrend;
  stress: StressResult;
  pf: ProForma | null;
  memo: string;
}

export function bankPack(months: MonthData[], end: string, settings: { currency: string; fyStartMonth: number; taxRate: number }, a: Assumptions, name: string, accounts?: LoanAccount[], lang: Lang = "en", asOf?: string | null): BankPack {
  const cur = settings.currency;
  const basis = twelveMonths(months, end, settings.fyStartMonth, asOf);
  const inputs: BankInputs = { rate: a.rate, tenor: a.tenor, principal12m: a.principal12m, inflation: a.inflation, accounts, lang, taxRate: settings.taxRate };
  const assessment = bankAssessment(basis, inputs, cur);
  const trend = yearTrend(months, end, settings.fyStartMonth, inputs, cur);
  const stress = stressTest(basis, assessment, { taxRate: settings.taxRate, importShare: a.importShare, rate: a.rate, lang });
  const pf = a.requestAmount && a.requestAmount > 0 ? proForma(basis, assessment, { amount: a.requestAmount, type: a.requestType ?? "term_loan" }, a.rate, a.tenor) : null;
  const memo = memoText(ruleMemo(name, assessment, { stress, pf, trend, cur, purpose: a.requestPurpose, lang }), lang);
  return { basis, assessment, trend, stress, pf, memo };
}

// ------------------------------------------------------------------ memos written for a set of inputs

/** The inputs each AI-written memo depends on: when one changes, the saved memo no longer describes the figures. */
const MEMO_INPUTS: Record<"bank" | "realprofit", (keyof Assumptions)[]> = {
  bank: ["requestAmount", "requestType", "requestPurpose", "rate", "tenor", "principal12m", "inflation", "importShare"],
  realprofit: ["inflation", "fxStart", "fxEnd", "importShare", "assetAge", "rate"],
};
const STAMP = /\n*<!-- inputs:(.*?) -->\s*$/;

export function memoInputsKey(section: "bank" | "realprofit", a: Assumptions): string {
  return MEMO_INPUTS[section].map((k) => (a[k] === null || a[k] === undefined || a[k] === "" ? "" : String(a[k]))).join("|");
}

/** Adds the inputs a memo was written for, as a hidden line at its end. */
export function stampMemo(body: string, section: "bank" | "realprofit", a: Assumptions): string {
  return `${body.replace(STAMP, "")}\n\n<!-- inputs:${memoInputsKey(section, a)} -->`;
}

/** The memo text without its stamp, and whether it was written for different inputs than today's. Unstamped (typed) memos never go stale. */
export function readMemo(body: string | null | undefined, section: "bank" | "realprofit", a: Assumptions): { text: string | null; stale: boolean } {
  if (!body) return { text: null, stale: false };
  const m = body.match(STAMP);
  return { text: body.replace(STAMP, "").trim(), stale: m !== null && m[1] !== memoInputsKey(section, a) };
}

/** Memo text with the hidden inputs line removed (for editing: an edited memo becomes the user's own and never goes stale). */
export const stripMemoStamp = (body: string | null | undefined) => (body ?? "").replace(STAMP, "");

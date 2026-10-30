import { balanced } from "@/lib/tolerance";
import type { Basis } from "./basis";
import { money, pct } from "./format";
import { DEFAULT_VAT } from "./kpis";

/**
 * How a credit analyst reads a set of accounts before lending.
 * The bands are common lender rules of thumb for small and mid-sized companies, not any one bank's policy:
 * each bank sets its own limits, and sector, collateral and the owners' track record also count.
 */

export type Band = "strong" | "watch" | "weak" | "info";
export type BankGroup = "Repayment" | "Liquidity" | "Capital" | "Performance" | "Working capital";
export type BankUnit = "x" | "%" | "days" | "cur";

export interface BankRatio {
  key: string;
  group: BankGroup;
  name: string;
  value: number | null;
  unit: BankUnit;
  band: Band;
  /** The rule of thumb, e.g. "1.25x or more". */
  guide: string;
  formula: string;
  /** What the figure tells the bank. */
  banker: string;
  /** What to do or say about it. */
  advice: string;
  /** Built on an assumption the user can replace (e.g. estimated repayments). */
  estimate?: string;
}

export interface RedFlag { key: string; severity: "high" | "medium"; title: string; detail: string; advice: string }

export interface DebtCapacity {
  /** Annual cash available for debt service: EBITDA less tax. */
  cashForDebt: number;
  /** Interest plus principal due in a year on today's debt. */
  existingService: number;
  /** Annual payments the cash supports at the target cover. */
  maxService: number;
  rate: number | null;
  rateSource: "input" | "implied" | null;
  tenor: number;
  targetDscr: number;
  maxLeverage: number;
  byDscr: number | null;
  byLeverage: number | null;
  headroom: number | null;
}

export interface BankInputs {
  /** VAT rate for the trend's earlier years (the assessment reads it from the basis). */
  vat?: number;
  /** Annual borrowing rate, %. */
  rate?: number | null;
  /** Years over which a new loan would be repaid. */
  tenor?: number | null;
  /** Loan principal due over the next 12 months (from the loan schedule). */
  principal12m?: number | null;
  /** Annual inflation, %, used to judge growth in real terms. */
  inflation?: number | null;
  /** Account lines (natural sign), so the current portion of long-term loans can be found among short-term borrowing. */
  accounts?: LoanAccount[];
  /** The language to write in (English when not given). */
  lang?: "en" | "ar";
  /** The company's tax rate (0.225): stands in for the tax charge when the books carry none. */
  taxRate?: number | null;
}

/** The fields of an account line the bank view needs. */
export interface LoanAccount { name: string; cls: string; amounts: Record<string, number> }

/** The lender rules of thumb used across the bank page, the stress test, the loan request and the report. */
export const BANK_LIMITS = {
  /** Debt service cover: at least this is "strong" and what a new loan must keep. */
  dscr: 1.25,
  /** Below this the business cannot pay its loans from trading. */
  dscrFloor: 1,
  /** Debt to EBITDA: at most this is "strong" and the cap for new lending. */
  debtEbitda: 3,
  debtEbitdaWatch: 4,
  intCover: 2.5,
  intCoverWatch: 1.5,
  /** Years over which existing long-term loans are assumed to be repaid when no schedule is entered. */
  existingLoanYears: 5,
} as const;

const CURRENT_PORTION = /current (portion|maturit)|due within (one|1|12)|instal?ments? due|الجزء المتداول|[اأإ]قساط/i;

/** Short-term borrowing accounts that are the part of long-term loans due within a year, and their balance at `period`. */
export function currentPortionOfLoans(accounts: LoanAccount[] | undefined, period: string): { amount: number; names: string[] } {
  const hits = (accounts ?? []).filter((a) => a.cls === "std" && CURRENT_PORTION.test(a.name) && (a.amounts[period] ?? 0) > 0);
  return { amount: hits.reduce((s, a) => s + (a.amounts[period] ?? 0), 0), names: hits.map((a) => a.name) };
}

export interface BankAssessment {
  ratios: BankRatio[];
  flags: RedFlag[];
  strengths: BankRatio[];
  weaknesses: BankRatio[];
  capacity: DebtCapacity;
  counts: Record<"strong" | "watch" | "weak", number>;
  /** Principal due in 12 months was estimated rather than entered. */
  principalEstimated: boolean;
  principal12m: number;
  /** Where the 12-month principal came from: the user's loan schedule, the current portion in the books, or an estimate. */
  principalSource: "entered" | "current_portion" | "estimate";
}

const ratio = (a: number, b: number) => (b ? a / b : null);
/** Higher is better: strong at or above `good`, watch at or above `ok`. */
const up = (v: number | null, good: number, ok: number): Band => (v === null ? "info" : v >= good ? "strong" : v >= ok ? "watch" : "weak");
/** Lower is better. */
const down = (v: number | null, good: number, ok: number): Band => (v === null ? "info" : v <= good ? "strong" : v <= ok ? "watch" : "weak");

export const BANK_CHECKLIST: { item: string; why: string }[] = [
  { item: "Audited financial statements for the last 3 years, with the auditor's report and notes", why: "The base of every credit file; a qualified opinion or missing notes delays the decision." },
  { item: "Management accounts for the current year to the latest month", why: "Shows the bank the business today, not only at the last year end." },
  { item: "Aged receivables and payables lists (by customer and supplier)", why: "Banks discount old and concentrated receivables; an ageing list answers that before it is asked." },
  { item: "Schedule of existing loans and facilities: lender, limit, balance, rate, repayments, security", why: "Must agree with your iScore credit report; differences raise doubts." },
  { item: "Bank statements for the last 6 to 12 months for every account", why: "Proves the turnover the accounts show actually passes through the bank." },
  { item: "Cash-flow forecast for the loan period, monthly for the first year", why: "Shows how each instalment will be paid; build it from these figures." },
  { item: "Commercial register, tax card, latest tax returns and VAT returns", why: "Legal standing and proof that taxes are filed and paid." },
  { item: "Fixed-asset register and any valuation reports for assets offered as security", why: "Supports the collateral the bank will rely on." },
  { item: "Profile of the owners and management, and the main customer and supplier contracts", why: "Banks lend to people and to dependable revenue as much as to numbers." },
];

/** The documents a bank asks for, in Arabic (same order as BANK_CHECKLIST). */
export const BANK_CHECKLIST_AR: { item: string; why: string }[] = [
  { item: "القوائم المالية المراجعة لآخر 3 سنوات، مع تقرير مراقب الحسابات والإيضاحات", why: "أساس كل ملف ائتماني؛ الرأي المتحفظ أو الإيضاحات الناقصة تؤخر القرار." },
  { item: "حسابات الإدارة للسنة الحالية حتى آخر شهر", why: "تُري البنك النشاط اليوم، لا في نهاية آخر سنة فقط." },
  { item: "كشوف أعمار ديون العملاء والموردين (حسب العميل والمورد)", why: "البنوك تخصم الأرصدة القديمة والمركزة؛ كشف الأعمار يجيب عن ذلك قبل السؤال." },
  { item: "جدول القروض والتسهيلات الحالية: الجهة، الحد، الرصيد، السعر، الأقساط، الضمانات", why: "يجب أن يطابق تقرير iScore الائتماني؛ أي اختلاف يثير الشكوك." },
  { item: "كشوف الحسابات البنكية لآخر 6 إلى 12 شهرًا لكل حساب", why: "تثبت أن حجم النشاط الظاهر في الحسابات يمر فعلًا عبر البنك." },
  { item: "توقع التدفق النقدي لفترة القرض، شهريًا للسنة الأولى", why: "يوضح كيف سيُسدد كل قسط؛ ابنه من هذه الأرقام." },
  { item: "السجل التجاري، البطاقة الضريبية، آخر الإقرارات الضريبية وإقرارات القيمة المضافة", why: "الوضع القانوني ودليل تقديم الإقرارات وسداد الضرائب." },
  { item: "سجل الأصول الثابتة وأي تقارير تقييم للأصول المقدمة كضمان", why: "يدعم الضمانات التي سيعتمد عليها البنك." },
  { item: "نبذة عن الملاك والإدارة، وأهم عقود العملاء والموردين", why: "البنوك تقرض الأشخاص والإيرادات الموثوقة بقدر ما تقرض الأرقام." },
];

export function bankAssessment(b: Basis, inp: BankInputs = {}, cur = "EGP"): BankAssessment {
  const { Pa, P, B } = b;
  const ar = inp.lang === "ar";
  const L = (en: string, a: string) => (ar ? a : en);
  const m = (v: number) => money(v, cur, true);
  const debt = B.std + B.ltd;
  const interest = Pa.interest_expenses;
  // The tenor applies to a new loan only; it never changes what is due on today's loans.
  const tenor = inp.tenor && inp.tenor > 0 ? inp.tenor : 5;
  const principalEstimated = inp.principal12m === null || inp.principal12m === undefined;
  const cp = currentPortionOfLoans(inp.accounts, b.end);
  // Without a loan schedule: the current portion of long-term loans when the books show one (it is what falls due within
  // a year), otherwise long-term loans repaid evenly over five years. Overdrafts and revolving lines are assumed renewed.
  const principalSource: BankAssessment["principalSource"] = !principalEstimated ? "entered" : cp.amount > 0 ? "current_portion" : "estimate";
  const principal12m = principalSource === "entered" ? Math.max(0, inp.principal12m!) : principalSource === "current_portion" ? cp.amount : B.ltd / BANK_LIMITS.existingLoanYears;
  // The tax charge for the year stands in for the tax paid on it.
  // Books without an income tax charge (Odoo posts none until the year end) still owe it: the profile rate on the profit.
  const taxCharge = Pa.tax_expenses > 0 ? Pa.tax_expenses : Math.max(0, Pa.ebt) * (inp.taxRate ?? 0);
  const cashForDebt = Pa.ebitda - taxCharge;
  const service = interest + principal12m;
  const R = P.revenue;
  const avgAR = b.avg("ar"), avgInv = b.avg("inventory"), avgAP = b.avg("ap"), avgWip = b.avg("wip");
  const cogs = P.cos - P.cos_depreciation;
  // Negative days (a receivable in credit, payables in debit) mean nothing: shown as n/a.
  // Receivables and payables net of VAT, as on the KPI page (the company's rate, 14% unless set).
  const vatF = 1 + Math.max(0, b.vat ?? DEFAULT_VAT);
  const dso = R > 0 && avgAR >= 0 ? (avgAR / vatF / R) * b.days : null;
  const dio = cogs > 0 && avgInv >= 0 ? (avgInv / cogs) * b.days : null;
  const dpo = cogs > 0 && avgAP >= 0 ? (avgAP / vatF / cogs) * b.days : null;
  const tnw = B.te - B.intangibles;
  const ltFunding = B.te + B.tncl - B.tnca;
  const growth = b.prior && b.prior.P.revenue > 0 ? ((Pa.revenue - b.prior.P.revenue) / b.prior.P.revenue) * 100 : null;
  const infl = inp.inflation ?? null;
  const est = principalSource === "current_portion"
    ? `Repayments taken from the current portion of long-term loans in the books (${cp.names.join(", ")}: ${m(principal12m)}). Enter the figure from your loan schedule if it differs.`
    : principalSource === "estimate" && B.ltd > 0 ? `Repayments estimated as long-term loans ÷ ${BANK_LIMITS.existingLoanYears} years (${m(principal12m)}). Enter the real figure from your loan schedule.` : undefined;

  const dscr = service > 0 ? cashForDebt / service : null;
  // No borrowing and no operating profit: there is nothing to measure (not "strong").
  const lev = Pa.ebitda > 0 ? debt / Pa.ebitda : null;
  const netLev = Pa.ebitda > 0 ? (debt - B.cash) / Pa.ebitda : null;
  const icr = interest > 0 ? Pa.ebit / interest : null;
  const ocfE = b.ocf !== null && P.ebitda > 0 ? (b.ocf / P.ebitda) * 100 : null;

  const ratios: BankRatio[] = [
    {
      key: "dscr", group: "Repayment", name: "Debt service cover (DSCR)", value: dscr, unit: "x",
      band: service > 0 ? up(dscr, BANK_LIMITS.dscr, BANK_LIMITS.dscrFloor) : "info", guide: `${BANK_LIMITS.dscr}x or more`,
      formula: "(EBITDA − tax) ÷ (interest + loan principal due in 12 months)",
      banker: service > 0 ? `Each ${cur} 1 of yearly loan payments is covered by ${cur} ${dscr!.toFixed(2)} of operating cash profit (EBITDA after tax). Below 1.0x the business cannot pay its loans from trading.` : "There is no interest or loan repayment to cover.",
      advice: dscr === null ? "With no debt service, lead with the cash the business generates." : dscr >= BANK_LIMITS.dscr ? "Lead with this: it is the first figure a credit committee looks at." : "Ask for a longer tenor or a grace period so yearly payments fall; show a monthly cash-flow forecast proving each instalment is covered; consider part-funding with equity.",
      estimate: est,
    },
    {
      key: "debt_ebitda", group: "Repayment", name: "Debt to EBITDA", value: lev, unit: "x",
      band: lev === null ? (debt > 0 ? "weak" : "info") : down(lev, BANK_LIMITS.debtEbitda, BANK_LIMITS.debtEbitdaWatch), guide: `${BANK_LIMITS.debtEbitda}x or less`,
      formula: "(short-term + long-term borrowing) ÷ EBITDA (12 months)",
      banker: lev === null ? (debt > 0 ? "Operating profit before depreciation is negative, so the debt cannot be repaid from trading." : "No borrowing, and no operating profit before depreciation to measure against.") : `It would take about ${lev.toFixed(1)} years of operating cash profit to repay all borrowing.`,
      advice: lev !== null && lev <= BANK_LIMITS.debtEbitda ? "Room to borrow: say so, and show how the new loan keeps this under 3x." : "Show the plan that lifts EBITDA (contracts signed, price increases) or reduce debt first; banks usually cap new lending around 3 to 4x.",
    },
    {
      key: "net_debt_ebitda", group: "Repayment", name: "Net debt to EBITDA", value: netLev, unit: "x",
      band: netLev === null ? (debt - B.cash > 0 ? "weak" : "info") : down(netLev, 2.5, 3.5), guide: "2.5x or less",
      formula: "(borrowing − cash) ÷ EBITDA (12 months)",
      banker: "Debt after using the cash on hand. Large cash beside large debt makes the bank ask why you borrow.",
      advice: B.cash > 0.5 * debt && debt > 0 ? "Explain the cash: customer advances, a payment due after the year end, or a deposit held as security." : "Fine as long as it moves with debt to EBITDA.",
    },
    {
      key: "int_cover", group: "Repayment", name: "Interest cover", value: icr, unit: "x",
      band: interest > 0 ? up(icr, BANK_LIMITS.intCover, BANK_LIMITS.intCoverWatch) : "info", guide: `${BANK_LIMITS.intCover}x or more`,
      formula: "EBIT ÷ interest expense",
      banker: interest <= 0 ? "No interest expense in the period." : icr! < 0 ? "An operating loss: nothing is left to pay the interest, which is met from cash or more borrowing." : `Operating profit pays the interest bill ${icr!.toFixed(1)} times. At today's Egyptian rates this falls quickly when you borrow more.`,
      advice: icr !== null && icr < BANK_LIMITS.intCover ? "Show the cover after the new loan at the quoted rate, and what happens if rates rise 2 to 3 points." : "Keep it: it shows the business carries its interest comfortably.",
    },
    {
      key: "current", group: "Liquidity", name: "Current ratio", value: B.tcl ? B.tca / B.tcl : null, unit: "x",
      band: up(ratio(B.tca, B.tcl), 1.2, 1), guide: "1.2x or more",
      formula: "current assets ÷ current liabilities",
      banker: "Whether short-term assets cover what falls due within a year.",
      advice: (ratio(B.tca, B.tcl) ?? 9) < 1.2 ? "If shareholders have lent to the company, offer to subordinate those loans in writing; many banks then treat them as equity. Refinancing part of the overdraft as a medium-term loan also lifts this ratio." : "Present it with the ageing list so the bank sees the current assets are collectable.",
    },
    {
      key: "quick", group: "Liquidity", name: "Quick ratio", value: ratio(B.cash + B.ar, B.tcl), unit: "x",
      band: up(ratio(B.cash + B.ar, B.tcl), 1, 0.7), guide: "1.0x or more",
      formula: "(cash + receivables) ÷ current liabilities",
      banker: "Liquidity without counting on selling stock.",
      advice: (ratio(B.cash + B.ar, B.tcl) ?? 9) < 1 ? "Explain how fast stock turns into cash (inventory days), and any confirmed orders against it." : "No action needed.",
    },
    {
      key: "lt_funding", group: "Liquidity", name: "Long-term funding surplus", value: ltFunding, unit: "cur",
      band: ltFunding >= 0 ? "strong" : "weak", guide: "Zero or more",
      formula: "equity + long-term liabilities − non-current assets",
      banker: ltFunding >= 0 ? "Long-term assets are funded by long-term money, as banks expect." : `Fixed assets exceed long-term funding by ${m(-ltFunding)}: they are partly funded with short-term money, which must be rolled over every year.`,
      advice: ltFunding >= 0 ? "No action needed." : "Ask the bank to convert part of the short-term facility into a medium-term loan matched to the life of the assets: it is safer for both sides and a common request.",
    },
    {
      key: "gearing", group: "Capital", name: "Debt to equity", value: B.te > 0 ? debt / B.te : null, unit: "x",
      band: B.te <= 0 ? "weak" : down(debt / B.te, 1, 2), guide: "1x or less",
      formula: "borrowing ÷ total equity",
      banker: B.te <= 0 ? "Equity is negative: losses have used up the owners' capital. Most banks will not lend until it is restored." : "How much of the business is funded by lenders rather than owners.",
      advice: B.te <= 0 || debt / B.te > 1 ? "Consider a capital increase or converting shareholder loans into capital before applying." : "Owners carry a fair share of the risk: mention it.",
    },
    {
      key: "liab_tnw", group: "Capital", name: "Liabilities to tangible net worth", value: tnw > 0 ? B.tl / tnw : null, unit: "x",
      band: tnw <= 0 ? "weak" : down(B.tl / tnw, 2.5, 4), guide: "2.5x or less",
      formula: "total liabilities ÷ (equity − intangible assets)",
      banker: "Banks remove goodwill and other intangibles from equity: they cannot be sold to repay a loan.",
      advice: B.intangibles > 0 ? `Intangibles of ${m(B.intangibles)} are deducted. Be ready to show what they are and whether they earn income.` : "No intangibles to deduct.",
    },
    {
      key: "equity_ratio", group: "Capital", name: "Equity ratio", value: B.ta ? (B.te / B.ta) * 100 : null, unit: "%",
      band: up(B.ta ? (B.te / B.ta) * 100 : null, 30, 15), guide: "30% or more",
      formula: "total equity ÷ total assets",
      banker: "The cushion that absorbs losses before lenders lose money.",
      advice: "Retaining profits instead of distributing them strengthens this year after year.",
    },
    {
      key: "rev_growth", group: "Performance", name: "Revenue growth", value: growth, unit: "%",
      band: growth === null ? "info" : infl !== null ? (growth >= infl ? "strong" : growth >= 0 ? "watch" : "weak") : growth >= 0 ? "strong" : "weak",
      guide: infl !== null ? `${pct(infl, 1)} or more (inflation)` : "Positive",
      formula: "(revenue − prior 12 months' revenue) ÷ prior revenue",
      banker: growth === null ? "Needs twelve earlier months to compare with." : infl !== null && growth < infl ? `Sales grew ${pct(growth, 1)}, below inflation of ${pct(infl, 1)}: in real terms volumes are probably falling.` : "Growth the bank can extend into its forecast.",
      advice: growth !== null && infl !== null && growth < infl ? "Separate price from volume: show units sold or customer numbers, and the price increases already in place." : "Explain what drives it and whether it lasts.",
    },
    {
      key: "ebitda_margin", group: "Performance", name: "EBITDA margin", value: R ? (P.ebitda / R) * 100 : null, unit: "%",
      band: up(R ? (P.ebitda / R) * 100 : null, 10, 5), guide: "10% or more (varies by sector)",
      formula: "EBITDA ÷ revenue",
      banker: "Operating cash profit on each sale: the source of loan repayments. Traders run lower margins than manufacturers.",
      advice: "Compare yourself with your sector when you present it, and explain any one-off costs in the year.",
    },
    {
      key: "ocf_ebitda", group: "Performance", name: "Cash conversion", value: ocfE, unit: "%",
      band: ocfE === null ? "info" : up(ocfE, 70, 40), guide: "70% or more",
      formula: "operating cash flow (after tax, before interest) ÷ EBITDA",
      banker: ocfE === null ? "Needs the balance sheet before the period." : `${pct(ocfE, 0)} of operating profit turned into cash. Low conversion means profit is tied up in customers and stock.`,
      advice: ocfE !== null && ocfE < 70 ? "Prepare a short note showing where the cash went (receivables, stock) and the collections made since the year end." : "Strong earnings quality: point it out.",
    },
    {
      key: "dso", group: "Working capital", name: "Customer days (DSO)", value: dso, unit: "days",
      band: down(dso, 60, 90), guide: "60 days or less",
      formula: "average receivables net of VAT ÷ revenue × days",
      banker: dso === null && avgAR < 0 ? "Receivables are in credit on average: customers have paid more than they were invoiced, or unpaid invoices sit in another account. Customer days cannot be measured." : "How long customers take to pay. Banks often lend against receivables but exclude balances over 90 days.",
      advice: dso === null && avgAR < 0 ? "Check in Data health which account holds customers' unpaid invoices and map it to Accounts Receivable before showing this to a bank." : dso !== null && dso > 60 ? "Bring the ageing list; show which large customers are slow and that they always pay (government, multinationals)." : "Quick collection: mention it.",
    },
    {
      key: "dio", group: "Working capital", name: "Stock days", value: dio, unit: "days",
      band: dio === null ? "info" : down(dio, 90, 150), guide: "90 days or less (varies by sector)",
      formula: "average inventory ÷ cost of sales before depreciation × days",
      banker: "Slow stock may be obsolete; banks advance less against it than against receivables.",
      advice: dio !== null && dio > 90 ? "Explain seasonal or strategic stock (imports ahead of devaluation, a contract), and any slow items written down." : "No action needed.",
    },
    {
      key: "dpo", group: "Working capital", name: "Supplier days", value: dpo, unit: "days",
      band: "info", guide: "Context only",
      formula: "average payables net of VAT ÷ cost of sales before depreciation × days",
      banker: "Very long supplier days can mean the business is short of cash and paying late.",
      advice: "If suppliers give long terms by agreement, say so.",
    },
    {
      key: "ccc", group: "Working capital", name: "Cash cycle", value: dso !== null && dio !== null && dpo !== null ? dso + dio + (cogs > 0 ? (avgWip / cogs) * b.days : 0) - dpo : null, unit: "days",
      band: "info", guide: "Context only",
      formula: "customer days + stock days + work-in-progress days − supplier days",
      banker: "Days of trading the business must fund itself, and so the working-capital line it needs.",
      advice: "Size the working-capital facility you ask for from this cycle and next year's sales.",
    },
  ];

  if (ar) {
    const x = (v: number | null, d: number) => (v === null ? "" : v.toFixed(d));
    const estAr = principalSource === "current_portion"
      ? `الأقساط مأخوذة من الجزء المتداول من القروض طويلة الأجل في الدفاتر (${cp.names.join("، ")}: ${m(principal12m)}). أدخل الرقم من جدول قروضك إن كان مختلفًا.`
      : principalSource === "estimate" && B.ltd > 0 ? `الأقساط مقدّرة كالقروض طويلة الأجل ÷ ${BANK_LIMITS.existingLoanYears} سنوات (${m(principal12m)}). أدخل الرقم الحقيقي من جدول قروضك.` : undefined;
    const curr = ratio(B.tca, B.tcl), quick = ratio(B.cash + B.ar, B.tcl);
    const A: Record<string, Partial<BankRatio>> = {
      dscr: { name: "تغطية خدمة الدين (DSCR)", guide: `${BANK_LIMITS.dscr} مرة أو أكثر`, formula: "(الأرباح قبل الفوائد والضرائب والإهلاك − الضرائب) ÷ (الفوائد + أقساط القروض المستحقة خلال 12 شهرًا)",
        banker: service > 0 ? `كل 1 ${cur} من أقساط القروض السنوية يغطيه ${x(dscr, 2)} ${cur} من الربح النقدي التشغيلي بعد الضرائب. أقل من 1.0 مرة يعني أن النشاط لا يستطيع سداد قروضه من عملياته.` : "لا توجد فوائد أو أقساط لتغطيتها.",
        advice: dscr === null ? "مع عدم وجود خدمة دين، ابدأ بالنقدية التي يولدها النشاط." : dscr >= BANK_LIMITS.dscr ? "ابدأ بهذا الرقم: إنه أول ما تنظر إليه لجنة الائتمان." : "اطلب مدة أطول أو فترة سماح لتنخفض الأقساط السنوية؛ اعرض توقعًا شهريًا للتدفق النقدي يثبت تغطية كل قسط؛ وفكّر في تمويل جزئي بحقوق ملكية.", estimate: estAr },
      debt_ebitda: { name: "الديون إلى الأرباح قبل الفوائد والضرائب والإهلاك", guide: `${BANK_LIMITS.debtEbitda} مرة أو أقل`, formula: "(الاقتراض قصير وطويل الأجل) ÷ الأرباح قبل الفوائد والضرائب والإهلاك (12 شهرًا)",
        banker: lev === null ? (debt > 0 ? "الربح التشغيلي قبل الإهلاك سالب، فلا يمكن سداد الديون من النشاط." : "لا اقتراض، ولا ربح تشغيلي قبل الإهلاك للقياس عليه.") : `يحتاج سداد كل الاقتراض نحو ${x(lev, 1)} سنة من الربح النقدي التشغيلي.`,
        advice: lev !== null && lev <= BANK_LIMITS.debtEbitda ? "هناك مساحة للاقتراض: قل ذلك، واعرض كيف يبقي القرض الجديد النسبة أقل من 3 مرات." : "اعرض الخطة التي ترفع الأرباح (عقود موقعة، زيادات أسعار) أو خفّض الديون أولًا؛ البنوك عادة تحدّ الإقراض الجديد عند 3 إلى 4 مرات." },
      net_debt_ebitda: { name: "صافي الديون إلى الأرباح قبل الفوائد والضرائب والإهلاك", guide: "2.5 مرة أو أقل", formula: "(الاقتراض − النقدية) ÷ الأرباح قبل الفوائد والضرائب والإهلاك (12 شهرًا)",
        banker: "الديون بعد استخدام النقدية المتاحة. نقدية كبيرة بجانب ديون كبيرة تجعل البنك يسأل لماذا تقترض.",
        advice: B.cash > 0.5 * debt && debt > 0 ? "اشرح النقدية: دفعات مقدمة من العملاء، أو دفعة مستحقة بعد نهاية السنة، أو وديعة كضمان." : "مقبولة ما دامت تتحرك مع نسبة الديون إلى الأرباح." },
      int_cover: { name: "تغطية الفوائد", guide: `${BANK_LIMITS.intCover} مرة أو أكثر`, formula: "الربح قبل الفوائد والضرائب ÷ مصروف الفوائد",
        banker: interest > 0 ? `الربح التشغيلي يغطي فاتورة الفوائد ${x(icr, 1)} مرة. بأسعار الفائدة الحالية في مصر تنخفض بسرعة عند اقتراض المزيد.` : "لا يوجد مصروف فوائد في الفترة.",
        advice: icr !== null && icr < BANK_LIMITS.intCover ? "اعرض التغطية بعد القرض الجديد بالسعر المعروض، وما يحدث إذا ارتفعت الأسعار 2 إلى 3 نقاط." : "حافظ عليها: تُظهر أن النشاط يتحمل فوائده بارتياح." },
      current: { name: "نسبة التداول", guide: "1.2 مرة أو أكثر", formula: "الأصول المتداولة ÷ الالتزامات المتداولة", banker: "هل تغطي الأصول قصيرة الأجل ما يستحق خلال سنة.",
        advice: (curr ?? 9) < 1.2 ? "إذا أقرض المساهمون الشركة، فاعرض إخضاع هذه القروض كتابيًا؛ كثير من البنوك تعاملها حينها كحقوق ملكية. وإعادة تمويل جزء من السحب على المكشوف كقرض متوسط الأجل ترفع هذه النسبة أيضًا." : "اعرضها مع كشف الأعمار ليرى البنك أن الأصول المتداولة قابلة للتحصيل." },
      quick: { name: "نسبة السيولة السريعة", guide: "1.0 مرة أو أكثر", formula: "(النقدية + العملاء) ÷ الالتزامات المتداولة", banker: "السيولة دون الاعتماد على بيع المخزون.",
        advice: (quick ?? 9) < 1 ? "اشرح سرعة تحول المخزون إلى نقدية (أيام المخزون)، وأي طلبيات مؤكدة مقابله." : "لا يلزم إجراء." },
      lt_funding: { name: "فائض التمويل طويل الأجل", guide: "صفر أو أكثر", formula: "حقوق الملكية + الالتزامات طويلة الأجل − الأصول غير المتداولة",
        banker: ltFunding >= 0 ? "الأصول طويلة الأجل ممولة بأموال طويلة الأجل، كما تتوقع البنوك." : `الأصول الثابتة تتجاوز التمويل طويل الأجل بمبلغ ${m(-ltFunding)}: إنها ممولة جزئيًا بأموال قصيرة الأجل يجب تجديدها كل سنة.`,
        advice: ltFunding >= 0 ? "لا يلزم إجراء." : "اطلب من البنك تحويل جزء من التسهيل قصير الأجل إلى قرض متوسط الأجل يتناسب مع عمر الأصول: أكثر أمانًا للطرفين وطلب شائع." },
      gearing: { name: "الديون إلى حقوق الملكية", guide: "مرة واحدة أو أقل", formula: "الاقتراض ÷ إجمالي حقوق الملكية",
        banker: B.te <= 0 ? "حقوق الملكية سالبة: الخسائر استهلكت رأس مال الملاك. معظم البنوك لن تقرض حتى تُستعاد." : "إلى أي حد يموّل المقرضون النشاط بدلًا من الملاك.",
        advice: B.te <= 0 || debt / B.te > 1 ? "فكّر في زيادة رأس المال أو تحويل قروض المساهمين إلى رأس مال قبل التقدم." : "الملاك يتحملون نصيبًا عادلًا من المخاطر: اذكر ذلك." },
      liab_tnw: { name: "الالتزامات إلى صافي الحقوق الملموسة", guide: "2.5 مرة أو أقل", formula: "إجمالي الالتزامات ÷ (حقوق الملكية − الأصول غير الملموسة)",
        banker: "البنوك تستبعد الشهرة والأصول غير الملموسة من حقوق الملكية: لا يمكن بيعها لسداد قرض.",
        advice: B.intangibles > 0 ? `تُخصم أصول غير ملموسة بقيمة ${m(B.intangibles)}. كن مستعدًا لتوضيح ماهيتها وهل تدر دخلًا.` : "لا توجد أصول غير ملموسة للخصم." },
      equity_ratio: { name: "نسبة حقوق الملكية", guide: "30% أو أكثر", formula: "إجمالي حقوق الملكية ÷ إجمالي الأصول", banker: "الوسادة التي تمتص الخسائر قبل أن يخسر المقرضون.", advice: "احتجاز الأرباح بدلًا من توزيعها يقوي هذه النسبة عامًا بعد عام." },
      rev_growth: { name: "نمو الإيرادات", guide: infl !== null ? `${pct(infl, 1)} أو أكثر (التضخم)` : "موجب", formula: "(الإيرادات − إيرادات الـ 12 شهرًا السابقة) ÷ الإيرادات السابقة",
        banker: growth === null ? "يحتاج اثني عشر شهرًا سابقة للمقارنة." : infl !== null && growth < infl ? `المبيعات نمت ${pct(growth, 1)}، أقل من تضخم ${pct(infl, 1)}: بالقيمة الحقيقية الكميات على الأرجح تنخفض.` : "نمو يمكن للبنك أن يبني عليه توقعاته.",
        advice: growth !== null && infl !== null && growth < infl ? "افصل السعر عن الكمية: اعرض الوحدات المباعة أو عدد العملاء، وزيادات الأسعار المطبقة." : "اشرح ما يدفعه وهل يستمر." },
      ebitda_margin: { name: "هامش الأرباح قبل الفوائد والضرائب والإهلاك", guide: "10% أو أكثر (يختلف حسب القطاع)", formula: "الأرباح قبل الفوائد والضرائب والإهلاك ÷ الإيرادات",
        banker: "الربح النقدي التشغيلي من كل عملية بيع: مصدر سداد القروض. التجار يعملون بهوامش أقل من المصنعين.", advice: "قارن نفسك بقطاعك عند العرض، واشرح أي تكاليف غير متكررة في السنة." },
      ocf_ebitda: { name: "التحويل النقدي", guide: "70% أو أكثر", formula: "التدفق النقدي التشغيلي (بعد الضرائب وقبل الفوائد) ÷ الأرباح قبل الفوائد والضرائب والإهلاك",
        banker: ocfE === null ? "يحتاج الميزانية السابقة للفترة." : `${pct(ocfE, 0)} من الربح التشغيلي تحول إلى نقدية. التحويل المنخفض يعني أن الربح محتجز لدى العملاء وفي المخزون.`,
        advice: ocfE !== null && ocfE < 70 ? "جهّز مذكرة قصيرة توضح أين ذهبت النقدية (العملاء، المخزون) والتحصيلات منذ نهاية السنة." : "جودة أرباح قوية: أشر إليها." },
      dso: { name: "أيام التحصيل من العملاء (DSO)", guide: "60 يومًا أو أقل", formula: "متوسط أرصدة العملاء بعد استبعاد ضريبة القيمة المضافة ÷ الإيرادات × الأيام",
        banker: dso === null && avgAR < 0 ? "أرصدة العملاء دائنة في المتوسط: العملاء دفعوا أكثر مما فُوتر لهم، أو الفواتير غير المسددة في حساب آخر. لا يمكن قياس أيام التحصيل." : "مدة سداد العملاء. البنوك تقرض غالبًا مقابل أرصدة العملاء لكنها تستبعد ما تجاوز 90 يومًا.",
        advice: dso === null && avgAR < 0 ? "راجع في سلامة البيانات أي حساب يحمل فواتير العملاء غير المسددة وصنّفه كعملاء ومدينين قبل عرض ذلك على بنك." : dso !== null && dso > 60 ? "أحضر كشف الأعمار؛ واعرض أي العملاء الكبار بطيئون وأنهم يسددون دائمًا (حكومة، شركات متعددة الجنسيات)." : "تحصيل سريع: اذكره." },
      dio: { name: "أيام المخزون", guide: "90 يومًا أو أقل (يختلف حسب القطاع)", formula: "متوسط المخزون ÷ تكلفة المبيعات قبل الإهلاك × الأيام",
        banker: "المخزون البطيء قد يكون متقادمًا؛ البنوك تقرض مقابله أقل مما تقرض مقابل أرصدة العملاء.",
        advice: dio !== null && dio > 90 ? "اشرح المخزون الموسمي أو الاستراتيجي (استيراد قبل تخفيض العملة، عقد)، وأي أصناف بطيئة خُفضت قيمتها." : "لا يلزم إجراء." },
      dpo: { name: "أيام السداد للموردين", guide: "للسياق فقط", formula: "متوسط أرصدة الموردين بعد استبعاد ضريبة القيمة المضافة ÷ تكلفة المبيعات قبل الإهلاك × الأيام", banker: "أيام سداد طويلة جدًا قد تعني نقص النقدية والتأخر في السداد.", advice: "إذا منحك الموردون آجالًا طويلة باتفاق، فاذكر ذلك." },
      ccc: { name: "الدورة النقدية", guide: "للسياق فقط", formula: "أيام التحصيل + أيام المخزون + أيام الإنتاج تحت التشغيل − أيام السداد للموردين", banker: "أيام النشاط التي يجب أن يمولها النشاط بنفسه، ومن ثم خط رأس المال العامل الذي يحتاجه.", advice: "حدد حجم تسهيل رأس المال العامل الذي تطلبه من هذه الدورة ومن مبيعات العام القادم." },
    };
    for (const r of ratios) Object.assign(r, A[r.key]);
  }

  const flags: RedFlag[] = [];
  const flag = (key: string, severity: RedFlag["severity"], title: string, detail: string, advice: string) => flags.push({ key, severity, title, detail, advice });
  if (!balanced(B.imbalance)) flag("imbalance", "high", L("The balance sheet does not balance", "الميزانية غير متوازنة"), L(`Assets differ from liabilities and equity by ${m(B.imbalance)}.`, `الأصول تختلف عن الالتزامات وحقوق الملكية بمبلغ ${m(B.imbalance)}.`), L("Fix the mapping in Data health before sharing anything with a bank.", "صحح التصنيف في سلامة البيانات قبل مشاركة أي شيء مع البنك."));
  if (B.te <= 0) flag("neg_equity", "high", L("Negative equity", "حقوق ملكية سالبة"), L(`Equity is ${m(B.te)}.`, `حقوق الملكية ${m(B.te)}.`), L("Restore equity (capital increase, converting shareholder loans) before applying. Under Egyptian company law, losses reaching half the capital also require an extraordinary general assembly to decide whether the company continues.", "أعد حقوق الملكية (زيادة رأس المال، تحويل قروض المساهمين) قبل التقدم. وفق قانون الشركات المصري، بلوغ الخسائر نصف رأس المال يستلزم أيضًا جمعية عامة غير عادية لتقرر استمرار الشركة."));
  if (P.net_income < 0) flag("loss", "high", L("A loss over the period", "خسارة خلال الفترة"), L(`Net result ${m(P.net_income)}.`, `صافي النتيجة ${m(P.net_income)}.`), L("Separate one-off items from the trading result and show the months since that prove recovery.", "افصل البنود غير المتكررة عن نتيجة النشاط، واعرض الأشهر اللاحقة التي تثبت التعافي."));
  const cashAfterInterest = b.ocf === null ? null : b.ocf - P.net_interest;
  if (P.net_income > 0 && cashAfterInterest !== null && cashAfterInterest < 0) flag("profit_no_cash", "high", L("Profit but no cash left after interest", "ربح دون نقدية متبقية بعد الفوائد"), L(`Profit ${m(P.net_income)}; operating cash flow ${m(b.ocf!)} less net interest paid ${m(P.net_interest)} leaves ${m(cashAfterInterest)}.`, `الربح ${m(P.net_income)}؛ التدفق النقدي التشغيلي ${m(b.ocf!)} ناقص صافي الفوائد المدفوعة ${m(P.net_interest)} يترك ${m(cashAfterInterest)}.`), L("The first question the analyst will ask. Prepare the reconciliation and the collections after the period end.", "أول سؤال سيطرحه المحلل. جهّز التسوية والتحصيلات بعد نهاية الفترة."));
  if (b.prior && b.prior.B.ar > 0 && b.prior.P.revenue > 0) {
    const arG = (B.ar / b.prior.B.ar - 1) * 100, rG = (Pa.revenue / b.prior.P.revenue - 1) * 100;
    if (arG - rG > 15) flag("ar_growth", "medium", L("Receivables grew much faster than sales", "أرصدة العملاء نمت أسرع كثيرًا من المبيعات"), L(`Receivables +${pct(arG, 0)} against sales +${pct(rG, 0)}.`, `العملاء +${pct(arG, 0)} مقابل المبيعات +${pct(rG, 0)}.`), L("Show the ageing and any large invoice billed near the year end; banks look for sales booked but not collectable.", "اعرض كشف الأعمار وأي فاتورة كبيرة صدرت قرب نهاية السنة؛ البنوك تبحث عن مبيعات مسجلة غير قابلة للتحصيل."));
  }
  // Stock is compared with the goods bought (cost of sales before depreciation), as stock days are.
  const priorCogs = b.prior ? b.prior.P.cos - b.prior.P.cos_depreciation : 0;
  if (b.prior && b.prior.B.inventory > 0 && priorCogs > 0) {
    const iG = (B.inventory / b.prior.B.inventory - 1) * 100, cG = (((Pa.cos - Pa.cos_depreciation) / priorCogs) - 1) * 100;
    if (iG - cG > 20) flag("inv_growth", "medium", L("Stock grew much faster than cost of sales", "المخزون نما أسرع كثيرًا من تكلفة المبيعات"), L(`Stock +${pct(iG, 0)} against cost of sales +${pct(cG, 0)}.`, `المخزون +${pct(iG, 0)} مقابل تكلفة المبيعات +${pct(cG, 0)}.`), L("Explain the build-up (imports ahead of price rises, a contract) and confirm slow items are written down.", "اشرح سبب التراكم (استيراد قبل ارتفاع الأسعار، عقد) وأكد تخفيض قيمة الأصناف بطيئة الحركة."));
  }
  if (B.ta > 0 && B.other_ca / B.ta > 0.15) flag("other_ca", "medium", L("Large other current assets", "أصول متداولة أخرى كبيرة"), L(`${m(B.other_ca)}, ${pct((B.other_ca / B.ta) * 100, 0)} of total assets.`, `${m(B.other_ca)}، ${pct((B.other_ca / B.ta) * 100, 0)} من إجمالي الأصول.`), L("If this includes amounts due from shareholders or sister companies, settle or document them: banks usually deduct them from net worth.", "إذا كانت تشمل مبالغ مستحقة من المساهمين أو شركات شقيقة، فسوّها أو وثّقها: البنوك عادة تخصمها من صافي الحقوق."));
  if (debt > 0 && B.cash > 0.5 * debt && interest > 0) flag("cash_and_debt", "medium", L("High cash alongside borrowing", "نقدية مرتفعة بجانب الاقتراض"), L(`Cash ${m(B.cash)} against borrowing ${m(debt)}.`, `النقدية ${m(B.cash)} مقابل اقتراض ${m(debt)}.`), L("Be ready to explain why the cash is not used to cut debt (deposits held as security, customer advances, timing).", "كن مستعدًا لشرح سبب عدم استخدام النقدية لخفض الديون (ودائع كضمان، دفعات مقدمة من العملاء، توقيت)."));
  if (b.prior && b.prior.B.tax_liab > 0 && B.tax_liab > b.prior.B.tax_liab * 1.5 && B.tax_liab > 0.05 * B.tcl) flag("tax_build", "medium", L("Taxes payable building up", "تراكم الضرائب المستحقة"), L(`Tax liabilities ${m(B.tax_liab)}, up from ${m(b.prior.B.tax_liab)}.`, `الالتزامات الضريبية ${m(B.tax_liab)}، بعد أن كانت ${m(b.prior.B.tax_liab)}.`), L("Show the tax payment receipts after the period end; overdue taxes worry lenders.", "اعرض إيصالات سداد الضرائب بعد نهاية الفترة؛ الضرائب المتأخرة تقلق المقرضين."));
  if (P.dividends > 0 && debt > 0 && (lev === null || lev > BANK_LIMITS.debtEbitda)) flag("dividends", "medium", L("Distributions while debt is high", "توزيعات أرباح مع ديون مرتفعة"), L(`${m(P.dividends)} distributed with debt at ${lev === null ? "n/a" : lev.toFixed(1) + "x"} EBITDA.`, `وُزّع ${m(P.dividends)} والديون ${lev === null ? "غير متاحة" : lev.toFixed(1) + " مرة"} من الأرباح قبل الفوائد والضرائب والإهلاك.`), L("Expect a covenant restricting dividends; offering one yourself can win better terms.", "توقع شرطًا يقيد التوزيعات؛ وعرضه بنفسك قد يحقق شروطًا أفضل."));
  if (b.factor !== 1 && !b.annualColumn) flag("coverage", "medium", L(`Only ${Math.round(b.covered * 10) / 10} months of figures in the last year`, `أرقام ${Math.round(b.covered * 10) / 10} أشهر فقط في السنة الأخيرة`), L("Yearly figures are scaled up from the months held.", "الأرقام السنوية مقدّرة من الأشهر المتاحة."), L("Upload the last audited statements as well, so the bank sees full years.", "ارفع آخر قوائم مراجعة أيضًا، ليرى البنك سنوات كاملة."));

  const rate = inp.rate && inp.rate > 0 ? inp.rate / 100 : null;
  const avgDebt = b.avg("std") + b.avg("ltd");
  const implied = !rate && avgDebt > 0 && P.interest_expenses > 0 ? (P.interest_expenses / avgDebt) * (365 / b.days) : null;
  const r = rate ?? implied;
  const targetDscr = BANK_LIMITS.dscr, maxLeverage = BANK_LIMITS.debtEbitda;
  const maxService = cashForDebt / targetDscr;
  const spare = maxService - service;
  const af = r ? (1 - Math.pow(1 + r, -tenor)) / r : null;
  const byDscr = af === null ? null : Math.max(0, spare * af);
  const byLeverage = Math.max(0, maxLeverage * Pa.ebitda - debt);
  const capacity: DebtCapacity = {
    cashForDebt, existingService: service, maxService, rate: r === null ? null : r * 100, rateSource: rate ? "input" : implied ? "implied" : null,
    tenor, targetDscr, maxLeverage, byDscr, byLeverage, headroom: byDscr === null ? byLeverage : Math.min(byDscr, byLeverage),
  };

  const scored = ratios.filter((x) => x.band !== "info");
  const counts = { strong: 0, watch: 0, weak: 0 };
  for (const x of scored) counts[x.band as keyof typeof counts]++;
  return {
    ratios, flags: flags.sort((a, c) => (a.severity === c.severity ? 0 : a.severity === "high" ? -1 : 1)),
    strengths: scored.filter((x) => x.band === "strong"), weaknesses: scored.filter((x) => x.band === "weak"),
    capacity, counts, principalEstimated, principal12m, principalSource,
  };
}

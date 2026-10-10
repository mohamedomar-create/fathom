import type { Basis } from "./basis";
import { money, pct } from "./format";

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
  /** Annual borrowing rate, %. */
  rate?: number | null;
  /** Years over which a new loan would be repaid. */
  tenor?: number | null;
  /** Loan principal due over the next 12 months (from the loan schedule). */
  principal12m?: number | null;
  /** Annual inflation, %, used to judge growth in real terms. */
  inflation?: number | null;
  targetDscr?: number;
  maxLeverage?: number;
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

export function bankAssessment(b: Basis, inp: BankInputs = {}, cur = "EGP"): BankAssessment {
  const { Pa, P, B } = b;
  const m = (v: number) => money(v, cur, true);
  const debt = B.std + B.ltd;
  const interest = Pa.interest_expenses;
  const tenor = inp.tenor && inp.tenor > 0 ? inp.tenor : 5;
  const principalEstimated = inp.principal12m === null || inp.principal12m === undefined;
  // Without a loan schedule: long-term loans repaid evenly over the tenor. Overdrafts and revolving lines are assumed renewed.
  const principal12m = principalEstimated ? B.ltd / tenor : Math.max(0, inp.principal12m!);
  const cashTax = Math.max(0, Pa.tax_expenses);
  const cashForDebt = Pa.ebitda - cashTax;
  const service = interest + principal12m;
  const R = P.revenue;
  const avgAR = b.avg("ar"), avgInv = b.avg("inventory"), avgAP = b.avg("ap");
  const cogs = P.cos - P.cos_depreciation;
  const dso = R > 0 ? (avgAR / R) * b.days : null;
  const dio = cogs > 0 ? (avgInv / cogs) * b.days : null;
  const dpo = cogs > 0 ? (avgAP / cogs) * b.days : null;
  const tnw = B.te - B.intangibles;
  const ltFunding = B.te + B.tncl - B.tnca;
  const growth = b.prior && b.prior.P.revenue > 0 ? ((Pa.revenue - b.prior.P.revenue) / b.prior.P.revenue) * 100 : null;
  const infl = inp.inflation ?? null;
  const est = principalEstimated && B.ltd > 0 ? `Repayments estimated as long-term loans ÷ ${tenor} years (${m(principal12m)}). Enter the real figure from your loan schedule.` : undefined;

  const dscr = service > 0 ? cashForDebt / service : null;
  const lev = Pa.ebitda > 0 ? debt / Pa.ebitda : debt > 0 ? null : 0;
  const netLev = Pa.ebitda > 0 ? (debt - B.cash) / Pa.ebitda : null;
  const icr = interest > 0 ? Pa.ebit / interest : null;
  const ocfE = b.ocf !== null && P.ebitda > 0 ? (b.ocf / P.ebitda) * 100 : null;

  const ratios: BankRatio[] = [
    {
      key: "dscr", group: "Repayment", name: "Debt service cover (DSCR)", value: dscr, unit: "x",
      band: service > 0 ? up(dscr, 1.25, 1) : "info", guide: "1.25x or more",
      formula: "(EBITDA − tax) ÷ (interest + loan principal due in 12 months)",
      banker: service > 0 ? `Each ${cur} 1 of yearly loan payments is covered by ${cur} ${dscr!.toFixed(2)} of cash from operations. Below 1.0x the business cannot pay its loans from trading.` : "There is no interest or loan repayment to cover.",
      advice: dscr === null ? "With no debt service, lead with the cash the business generates." : dscr >= 1.25 ? "Lead with this: it is the first figure a credit committee looks at." : "Ask for a longer tenor or a grace period so yearly payments fall; show a monthly cash-flow forecast proving each instalment is covered; consider part-funding with equity.",
      estimate: est,
    },
    {
      key: "debt_ebitda", group: "Repayment", name: "Debt to EBITDA", value: lev, unit: "x",
      band: lev === null ? "weak" : down(lev, 3, 4), guide: "3x or less",
      formula: "(short-term + long-term borrowing) ÷ EBITDA (12 months)",
      banker: lev === null ? "Operating profit before depreciation is negative, so the debt cannot be repaid from trading." : `It would take about ${lev.toFixed(1)} years of operating cash profit to repay all borrowing.`,
      advice: lev !== null && lev <= 3 ? "Room to borrow: say so, and show how the new loan keeps this under 3x." : "Show the plan that lifts EBITDA (contracts signed, price increases) or reduce debt first; banks usually cap new lending around 3 to 4x.",
    },
    {
      key: "net_debt_ebitda", group: "Repayment", name: "Net debt to EBITDA", value: netLev, unit: "x",
      band: netLev === null ? "info" : down(netLev, 2.5, 3.5), guide: "2.5x or less",
      formula: "(borrowing − cash) ÷ EBITDA (12 months)",
      banker: "Debt after using the cash on hand. Large cash beside large debt makes the bank ask why you borrow.",
      advice: B.cash > 0.5 * debt && debt > 0 ? "Explain the cash: customer advances, a payment due after the year end, or a deposit held as security." : "Fine as long as it moves with debt to EBITDA.",
    },
    {
      key: "int_cover", group: "Repayment", name: "Interest cover", value: icr, unit: "x",
      band: interest > 0 ? up(icr, 2.5, 1.5) : "info", guide: "2.5x or more",
      formula: "EBIT ÷ interest expense",
      banker: interest > 0 ? `Operating profit pays the interest bill ${icr!.toFixed(1)} times. At today's Egyptian rates this falls quickly when you borrow more.` : "No interest expense in the period.",
      advice: icr !== null && icr < 2.5 ? "Show the cover after the new loan at the quoted rate, and what happens if rates rise 2 to 3 points." : "Keep it: it shows the business carries its interest comfortably.",
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
      formula: "operating cash flow ÷ EBITDA",
      banker: ocfE === null ? "Needs the balance sheet before the period." : `${pct(ocfE, 0)} of operating profit turned into cash. Low conversion means profit is tied up in customers and stock.`,
      advice: ocfE !== null && ocfE < 70 ? "Prepare a short note showing where the cash went (receivables, stock) and the collections made since the year end." : "Strong earnings quality: point it out.",
    },
    {
      key: "dso", group: "Working capital", name: "Customer days (DSO)", value: dso, unit: "days",
      band: down(dso, 60, 90), guide: "60 days or less",
      formula: "average receivables ÷ revenue × days",
      banker: "How long customers take to pay. Banks often lend against receivables but exclude balances over 90 days.",
      advice: dso !== null && dso > 60 ? "Bring the ageing list; show which large customers are slow and that they always pay (government, multinationals)." : "Quick collection: mention it.",
    },
    {
      key: "dio", group: "Working capital", name: "Stock days", value: dio, unit: "days",
      band: dio === null ? "info" : down(dio, 90, 150), guide: "90 days or less (varies by sector)",
      formula: "average inventory ÷ cost of sales × days",
      banker: "Slow stock may be obsolete; banks advance less against it than against receivables.",
      advice: dio !== null && dio > 90 ? "Explain seasonal or strategic stock (imports ahead of devaluation, a contract), and any slow items written down." : "No action needed.",
    },
    {
      key: "dpo", group: "Working capital", name: "Supplier days", value: dpo, unit: "days",
      band: "info", guide: "Context only",
      formula: "average payables ÷ cost of sales × days",
      banker: "Very long supplier days can mean the business is short of cash and paying late.",
      advice: "If suppliers give long terms by agreement, say so.",
    },
    {
      key: "ccc", group: "Working capital", name: "Cash cycle", value: dso !== null && dio !== null && dpo !== null ? dso + dio - dpo : null, unit: "days",
      band: "info", guide: "Context only",
      formula: "customer days + stock days − supplier days",
      banker: "Days of trading the business must fund itself, and so the working-capital line it needs.",
      advice: "Size the working-capital facility you ask for from this cycle and next year's sales.",
    },
  ];

  const flags: RedFlag[] = [];
  const flag = (key: string, severity: RedFlag["severity"], title: string, detail: string, advice: string) => flags.push({ key, severity, title, detail, advice });
  if (Math.abs(B.imbalance) > 1) flag("imbalance", "high", "The balance sheet does not balance", `Assets differ from liabilities and equity by ${m(B.imbalance)}.`, "Fix the mapping in Data health before sharing anything with a bank.");
  if (B.te <= 0) flag("neg_equity", "high", "Negative equity", `Equity is ${m(B.te)}.`, "Restore equity (capital increase, converting shareholder loans) before applying. Under Egyptian company law, losses reaching half the capital also require an extraordinary general assembly to decide whether the company continues.");
  if (P.net_income < 0) flag("loss", "high", "A loss over the period", `Net result ${m(P.net_income)}.`, "Separate one-off items from the trading result and show the months since that prove recovery.");
  if (P.net_income > 0 && b.ocf !== null && b.ocf < 0) flag("profit_no_cash", "high", "Profit but negative operating cash flow", `Profit ${m(P.net_income)}, operating cash flow ${m(b.ocf)}.`, "The first question the analyst will ask. Prepare the reconciliation and the collections after the period end.");
  if (b.prior && b.prior.B.ar > 0 && b.prior.P.revenue > 0) {
    const arG = (B.ar / b.prior.B.ar - 1) * 100, rG = (Pa.revenue / b.prior.P.revenue - 1) * 100;
    if (arG - rG > 15) flag("ar_growth", "medium", "Receivables grew much faster than sales", `Receivables +${pct(arG, 0)} against sales +${pct(rG, 0)}.`, "Show the ageing and any large invoice billed near the year end; banks look for sales booked but not collectable.");
  }
  if (b.prior && b.prior.B.inventory > 0 && b.prior.P.cos > 0) {
    const iG = (B.inventory / b.prior.B.inventory - 1) * 100, cG = ((Pa.cos / b.prior.P.cos) - 1) * 100;
    if (iG - cG > 20) flag("inv_growth", "medium", "Stock grew much faster than cost of sales", `Stock +${pct(iG, 0)} against cost of sales +${pct(cG, 0)}.`, "Explain the build-up (imports ahead of price rises, a contract) and confirm slow items are written down.");
  }
  if (B.ta > 0 && B.other_ca / B.ta > 0.15) flag("other_ca", "medium", "Large other current assets", `${m(B.other_ca)}, ${pct((B.other_ca / B.ta) * 100, 0)} of total assets.`, "If this includes amounts due from shareholders or sister companies, settle or document them: banks usually deduct them from net worth.");
  if (debt > 0 && B.cash > 0.5 * debt && interest > 0) flag("cash_and_debt", "medium", "High cash alongside borrowing", `Cash ${m(B.cash)} against borrowing ${m(debt)}.`, "Be ready to explain why the cash is not used to cut debt (deposits held as security, customer advances, timing).");
  if (b.prior && b.prior.B.tax_liab > 0 && B.tax_liab > b.prior.B.tax_liab * 1.5 && B.tax_liab > 0.05 * B.tcl) flag("tax_build", "medium", "Taxes payable building up", `Tax liabilities ${m(B.tax_liab)}, up from ${m(b.prior.B.tax_liab)}.`, "Show the tax payment receipts after the period end; overdue taxes worry lenders.");
  if (P.dividends > 0 && (lev === null || lev > 3)) flag("dividends", "medium", "Distributions while debt is high", `${m(P.dividends)} distributed with debt at ${lev === null ? "n/a" : lev.toFixed(1) + "x"} EBITDA.`, "Expect a covenant restricting dividends; offering one yourself can win better terms.");
  if (b.covered < 12 && !b.annualColumn) flag("coverage", "medium", `Only ${b.covered} months of figures`, "Yearly figures are scaled up from the months held.", "Upload the last audited statements as well, so the bank sees full years.");

  const rate = inp.rate && inp.rate > 0 ? inp.rate / 100 : null;
  const avgDebt = b.avg("std") + b.avg("ltd");
  const implied = !rate && avgDebt > 0 && P.interest_expenses > 0 ? (P.interest_expenses / avgDebt) * (365 / b.days) : null;
  const r = rate ?? implied;
  const targetDscr = inp.targetDscr ?? 1.25, maxLeverage = inp.maxLeverage ?? 3;
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
    capacity, counts, principalEstimated, principal12m,
  };
}

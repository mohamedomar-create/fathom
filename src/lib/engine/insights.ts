import { div, fixed, money, pct } from "./format";
import { KPI_DEFS } from "./kpis";
import type { Waterfall } from "./cashflow";
import type { BSCalc, PLCalc } from "./types";

export type FindingKind = "risk" | "watch" | "win";
export type FindingSection = "trend" | "kpis" | "profitability" | "cashflow" | "bs";
export interface Finding { sev: 1 | 2 | 3; kind: FindingKind; section: FindingSection; title: string; text: string }

export interface InsightCtx {
  P: PLCalc;
  B: BSCalc;
  Pprev: PLCalc | null;
  K: Record<string, number | null>;
  W: Waterfall | null;
  /** Resolved targets (company settings over KPI defaults). */
  tg: Record<string, number | null>;
  Ps: PLCalc[];
  Bs: BSCalc[];
  /** The month of each entry in Ps and Bs; when given, only calendar-consecutive months are compared. */
  periods?: string[];
  days: number;
  status: Record<string, boolean | null>;
  cur: string;
  /** "last month" | "the prior quarter" | "the prior year" */
  priorLabel?: string;
  /** "month" | "quarter" | "year": the length of the period shown. */
  periodWord?: string;
  /** Names of the KPIs the company tracks and rates critical that are off target; defaults to the standard set. */
  critical?: string[];
  /** The language to write in; English when not given (the engine's tests check the English word for word). */
  lang?: "en" | "ar";
}

const PRIOR_AR: Record<string, string> = { "last month": "الشهر السابق", "the prior quarter": "الربع السابق", "the prior year": "السنة السابقة",
  "the same days last month": "الأيام نفسها من الشهر السابق", "the same days of the prior quarter": "الأيام نفسها من الربع السابق", "the same days of the prior year": "الأيام نفسها من السنة السابقة" };
const PER_AR: Record<string, string> = { month: "شهر", quarter: "ربع", year: "سنة" };

/** Rule-based findings in plain language, ranked by severity (port of the reference engine). */
export function insights(ctx: InsightCtx): Finding[] {
  const { P, B, Pprev: Pp, K, W, tg, Ps, Bs, cur } = ctx;
  const m = (v: number) => money(v, cur);
  const prior = ctx.priorLabel ?? "last month";
  const per = ctx.periodWord ?? "month";
  const out: Finding[] = [];
  const add = (sev: 1 | 2 | 3, kind: FindingKind, section: FindingSection, title: string, text: string) => out.push({ sev, kind, section, title, text });
  const ar = ctx.lang === "ar";
  const priorA = PRIOR_AR[prior] ?? prior, perA = PER_AR[per] ?? per;
  /** English or Arabic, with the same figures. */
  const L = (en: string, a: string) => (ar ? a : en);
  const R = P.revenue;

  if (Pp && Pp.revenue) {
    const ch = ((R - Pp.revenue) / Math.abs(Pp.revenue)) * 100;
    if (Math.abs(ch) >= 5)
      add(Math.abs(ch) >= 10 ? 2 : 1, ch > 0 ? "win" : "risk", "trend", L(`Revenue ${ch > 0 ? "up" : "down"} ${fixed(Math.abs(ch), 1)}% on ${prior}`, `الإيرادات ${ch > 0 ? "ارتفعت" : "انخفضت"} ${fixed(Math.abs(ch), 1)}% عن ${priorA}`),
        L(`${m(R)} against ${m(Pp.revenue)}. ` + (ch > 0 ? "Check it is repeatable, not a one-off order." : "Find out which customers or products drove the drop."),
          `${m(R)} مقابل ${m(Pp.revenue)}. ` + (ch > 0 ? "تأكد أنها قابلة للتكرار وليست طلبية لمرة واحدة." : "اعرف أي العملاء أو المنتجات وراء الانخفاض.")));
  }
  const tRev = tg.total_revenue;
  if (tRev) {
    const gap = ((R - tRev) / tRev) * 100;
    add(gap < -5 ? 2 : 1, gap >= 0 ? "win" : gap < -5 ? "risk" : "watch", "kpis", L(`Revenue is ${fixed(Math.abs(gap), 1)}% ${gap >= 0 ? "above" : "below"} target`, `الإيرادات ${gap >= 0 ? "أعلى" : "أقل"} من المستهدف بنسبة ${fixed(Math.abs(gap), 1)}%`), L(`${m(R)} against a target of ${m(tRev)}.`, `${m(R)} مقابل مستهدف ${m(tRev)}.`));
  }
  if (Ps.length >= 6) {
    const s = (a: PLCalc[]) => a.reduce((x, p) => x + p.revenue, 0);
    const last3 = s(Ps.slice(-3)), prev3 = s(Ps.slice(-6, -3));
    if (prev3) {
      const g3 = ((last3 - prev3) / prev3) * 100;
      if (Math.abs(g3) >= 3)
        add(1, g3 > 0 ? "win" : "watch", "trend", L(`Last 3 months ${g3 > 0 ? "ahead of" : "behind"} the 3 months before by ${fixed(Math.abs(g3), 1)}%`, `آخر 3 أشهر ${g3 > 0 ? "أعلى" : "أقل"} من الأشهر الثلاثة السابقة بنسبة ${fixed(Math.abs(g3), 1)}%`),
          L("A trend over three months is more reliable than one month on its own.", "الاتجاه على مدى ثلاثة أشهر أوثق من شهر واحد وحده."));
    }
  }
  const gpm = K.gpm;
  const tgtG = tg.gpm ?? 35;
  if (gpm !== null && gpm !== undefined) {
    if (Pp && Pp.revenue) {
      const d = gpm - (Pp.gross_profit / Pp.revenue) * 100;
      if (Math.abs(d) >= 1)
        add(d < 0 ? 2 : 1, d < 0 ? "risk" : "win", "profitability", L(`Gross margin ${d < 0 ? "fell" : "rose"} ${fixed(Math.abs(d), 1)} points`, `هامش مجمل الربح ${d < 0 ? "انخفض" : "ارتفع"} ${fixed(Math.abs(d), 1)} نقطة`),
          L(`Now ${pct(gpm, 1)} (was ${pct(gpm - d, 1)}). ` + (Math.abs(d) >= 10 ? "A swing this large is usually timing: cost of sales is booked when goods are delivered, revenue when they are invoiced. Check first what was delivered in one month and invoiced in another, then supplier prices, discounts and mix." : d < 0 ? "Check supplier prices, discounts and product mix." : "Hold on to whatever drove this."),
            `الآن ${pct(gpm, 1)} (كان ${pct(gpm - d, 1)}). ` + (Math.abs(d) >= 10 ? "تقلب بهذا الحجم غالبًا سببه التوقيت: تُسجل تكلفة المبيعات عند التسليم والإيراد عند الفوترة. راجع أولًا ما سُلّم في شهر وفُوتر في آخر، ثم أسعار الموردين والخصومات والتشكيلة." : d < 0 ? "راجع أسعار الموردين والخصومات وتشكيلة المنتجات." : "حافظ على ما أدى إلى ذلك.")));
    }
    if (gpm < tgtG) add(2, "risk", "kpis", L(`Gross margin ${pct(gpm, 1)} is under the ${pct(tgtG, 0)} target`, `هامش مجمل الربح ${pct(gpm, 1)} أقل من المستهدف ${pct(tgtG, 0)}`), L(`Each 1 point is worth about ${m(R * 0.01)} of gross profit a ${per} at this revenue.`, `كل نقطة واحدة تساوي نحو ${m(R * 0.01)} من مجمل الربح في ال${perA} عند هذه الإيرادات.`));
  }
  const vcr = div(P.variable_costs, R);
  if (R && vcr !== null && vcr < 1) {
    const bep = P.fixed_costs / (1 - vcr);
    const mos = ((R - bep) / R) * 100;
    if (R < bep) add(3, "risk", "profitability", L("Below breakeven: the business is losing money on operations", "أقل من نقطة التعادل: النشاط يخسر من عملياته"), L(`It needs ${m(bep)} of revenue to cover its costs and made ${m(R)}, a shortfall of ${m(bep - R)}.`, `يحتاج إلى ${m(bep)} من الإيرادات لتغطية تكاليفه وحقق ${m(R)}، بعجز ${m(bep - R)}.`));
    else if (mos < 15) add(2, "watch", "profitability", L(`Thin safety cushion: revenue can fall only ${fixed(mos, 0)}% before losses start`, `هامش أمان ضيق: يمكن أن تنخفض الإيرادات ${fixed(mos, 0)}% فقط قبل بدء الخسارة`), L(`Breakeven is ${m(bep)} against revenue of ${m(R)}.`, `نقطة التعادل ${m(bep)} مقابل إيرادات ${m(R)}.`));
    else add(1, "win", "profitability", L(`Comfortable cushion: revenue can fall ${fixed(mos, 0)}% before losses start`, `هامش أمان مريح: يمكن أن تنخفض الإيرادات ${fixed(mos, 0)}% قبل بدء الخسارة`), L(`Breakeven is ${m(bep)}.`, `نقطة التعادل ${m(bep)}.`));
    // Operating leverage: contribution over operating profit (contribution less fixed costs).
    const cm = R - P.variable_costs;
    if (P.operating_profit > 0) {
      const dol = cm / P.operating_profit;
      if (dol > 3) add(1, "watch", "profitability", L(`High operating leverage (${fixed(dol, 1)}x)`, `رافعة تشغيلية مرتفعة (${fixed(dol, 1)} مرة)`), L(`A 10% change in revenue moves operating profit by about ${fixed(dol * 10, 0)}%. Good when sales grow, painful when they fall.`, `تغير الإيرادات 10% يحرك ربح التشغيل بنحو ${fixed(dol * 10, 0)}%. جيد عندما تنمو المبيعات، ومؤلم عندما تنخفض.`));
    }
  }
  if (P.ebit < 0) add(3, "risk", "profitability", L(`Operating loss this ${per}`, `خسارة تشغيلية في هذا ال${perA}`), L(`EBIT is ${m(P.ebit)}.`, `الربح قبل الفوائد والضرائب ${m(P.ebit)}.`));
  if (W) {
    const { ocf, ncf } = W;
    if (P.ebit > 0 && ocf < 0) add(3, "risk", "cashflow", L("Profit is not turning into cash", "الربح لا يتحول إلى نقدية"), L(`EBIT is ${m(P.ebit)} but operating cash flow is ${m(ocf)}. Look at receivables, stock and payables first.`, `الربح قبل الفوائد والضرائب ${m(P.ebit)} لكن التدفق النقدي التشغيلي ${m(ocf)}. ابدأ بمراجعة العملاء والمخزون والموردين.`));
    else if (ocf > 0 && P.ebit > 0 && ocf < 0.5 * P.ebit) add(1, "watch", "cashflow", L("Less than half of profit became cash", "أقل من نصف الربح تحول إلى نقدية"), L(`Operating cash flow ${m(ocf)} vs EBIT ${m(P.ebit)}.`, `التدفق النقدي التشغيلي ${m(ocf)} مقابل ربح قبل الفوائد والضرائب ${m(P.ebit)}.`));
    const ncfs: number[] = [];
    const next = (a: string, b: string) => { const [y, m] = a.split("-").map(Number); return b === `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}`; };
    for (let i = Math.max(1, Bs.length - 3); i < Bs.length; i++)
      if (!ctx.periods || next(ctx.periods[i - 1], ctx.periods[i])) ncfs.push(Bs[i].cash - Bs[i - 1].cash - (Bs[i].std + Bs[i].ltd - (Bs[i - 1].std + Bs[i - 1].ltd)));
    const sum = ncfs.reduce((a, b) => a + b, 0);
    if (ncfs.length && sum < 0 && B.cash > 0) {
      const burn = -sum / ncfs.length;
      add(B.cash / burn < 3 ? 3 : 2, "risk", "cashflow", L(`Net cash outflow: about ${fixed(B.cash / burn, 1)} months of cash left at this rate`, `صافي تدفق نقدي خارج: تكفي النقدية نحو ${fixed(B.cash / burn, 1)} شهر بهذا المعدل`),
        L(`Before any new borrowing, the business used about ${m(burn)} a month over the last ${ncfs.length} months (change in cash less change in borrowing); cash on hand is ${m(B.cash)}.`,
          `قبل أي اقتراض جديد، استخدم النشاط نحو ${m(burn)} شهريًا خلال آخر ${ncfs.length} أشهر (التغير في النقدية ناقص التغير في الاقتراض)؛ والنقدية المتاحة ${m(B.cash)}.`));
    } else if (ncf > 0 && ncfs.length >= 2 && ncfs.every((x) => x > 0)) add(1, "win", "cashflow", L(`Cash has grown ${ncfs.length} months in a row`, `النقدية نمت ${ncfs.length} أشهر متتالية`), L(`Cash on hand is ${m(B.cash)}.`, `النقدية المتاحة ${m(B.cash)}.`));
  }
  if (B.cash < 0) add(3, "risk", "cashflow", L("Negative cash balance", "رصيد نقدية سالب"), L("Check for an overdraft that should sit in short-term debt.", "تحقق من وجود سحب على المكشوف يجب أن يظهر ضمن القروض قصيرة الأجل."));
  for (const [key, nm, hint, nmA, hintA] of [
    ["ar_days", "Customers take", "Chase overdue invoices; tighten credit terms.", "العملاء يستغرقون", "تابع الفواتير المتأخرة وشدد شروط الائتمان."],
    ["inv_days", "Stock sits for", "Slow-moving stock ties up cash; review reorder levels.", "المخزون يبقى", "المخزون بطيء الحركة يحتجز النقدية؛ راجع حدود إعادة الطلب."],
  ] as const) {
    const v = K[key];
    const tgt = tg[key] ?? (key === "ar_days" ? 45 : 60);
    if (v !== null && v !== undefined && tgt && v > tgt * 1.1) {
      const tied = ((v - tgt) / ctx.days) * (key === "ar_days" ? R : P.cos - P.cos_depreciation);
      add(2, "risk", "kpis", L(`${nm} ${fixed(v, 0)} days (target ${fixed(tgt, 0)})`, `${nmA} ${fixed(v, 0)} يومًا (المستهدف ${fixed(tgt, 0)})`), L(`About ${m(tied)} extra cash is tied up. ${hint}`, `نحو ${m(tied)} نقدية إضافية محتجزة. ${hintA}`));
    }
  }
  const ccc = K.ccc;
  if (ccc != null && ccc > 60) add(1, "watch", "kpis", L(`Cash conversion cycle is ${fixed(ccc, 0)} days`, `دورة التحويل النقدي ${fixed(ccc, 0)} يومًا`), L("That is how long money is out before it comes back (receivable days + stock and work-in-progress days − supplier days).", "هذه هي المدة التي تخرج فيها النقدية قبل أن تعود (أيام التحصيل + أيام المخزون والإنتاج تحت التشغيل − أيام السداد للموردين)."));
  const cr = K.current;
  if (cr != null && cr < 1) add(3, "risk", "kpis", L(`Current ratio ${fixed(cr, 2)}: short-term bills exceed short-term assets`, `نسبة التداول ${fixed(cr, 2)}: الالتزامات قصيرة الأجل تتجاوز الأصول قصيرة الأجل`), L("Risk of not meeting payments on time.", "خطر عدم السداد في المواعيد."));
  else if (cr != null && cr < 1.2) add(1, "watch", "kpis", L(`Current ratio only ${fixed(cr, 2)}`, `نسبة التداول ${fixed(cr, 2)} فقط`), L("Thin buffer for short-term bills.", "هامش ضيق لتغطية الالتزامات قصيرة الأجل."));
  const ic = K.int_cover;
  if (ic != null && ic < 1.5) add(ic < 1 ? 3 : 2, "risk", "kpis", L(`Interest cover ${fixed(ic, 1)}x`, `تغطية الفوائد ${fixed(ic, 1)} مرة`), ic < 0 ? L("Operating loss: profit does not cover the interest at all.", "خسارة تشغيلية: الربح لا يغطي الفوائد إطلاقًا.") : L("Operating profit barely covers interest cost.", "الربح التشغيلي بالكاد يغطي تكلفة الفوائد."));
  if (B.te > 0 && B.debt / B.te > 1.5) add(2, "watch", "kpis", L(`Debt is ${fixed(B.debt / B.te, 1)}x equity`, `الديون ${fixed(B.debt / B.te, 1)} مرة من حقوق الملكية`), L("High borrowing relative to owners' capital.", "اقتراض مرتفع مقارنة برأس مال الملاك."));
  if (R && P.fixed_costs / R > 0.35) add(1, "watch", "profitability", L(`Fixed costs take ${fixed((P.fixed_costs / R) * 100, 0)}% of revenue`, `التكاليف الثابتة تستهلك ${fixed((P.fixed_costs / R) * 100, 0)}% من الإيرادات`), L("Costs that do not move with sales are what make slow months hurt.", "التكاليف التي لا تتحرك مع المبيعات هي ما يجعل الأشهر البطيئة مؤلمة."));
  const crit = ctx.critical ?? KPI_DEFS.filter((d) => d.importance === "Critical" && ctx.status[d.key] === false).map((d) => d.name);
  if (crit.length) add(2, "risk", "kpis", L(`${crit.length} critical KPI${crit.length > 1 ? "s" : ""} off target`, `مؤشرات حرجة خارج المستهدف: ${crit.length}`), crit.join(ar ? "، " : ", ") + ".");
  if (Math.abs(B.imbalance) > 0.5) add(3, "risk", "bs", L("Balance sheet does not balance", "الميزانية غير متوازنة"), L(`Out by ${m(B.imbalance)}. Fix the source data before relying on cash flow, ROE or liquidity numbers.`, `الفرق ${m(B.imbalance)}. صحح بيانات المصدر قبل الاعتماد على أرقام التدفق النقدي أو العائد على حقوق الملكية أو السيولة.`));
  out.sort((a, b) => b.sev - a.sev || Number(a.kind !== "risk") - Number(b.kind !== "risk"));
  return out;
}

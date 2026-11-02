import { area } from "../types";

/** Highlighted statements: shading, better/worse, flags and colour marks. */
export const hl = area(
  {
    better: "better", worse: "worse", up: "up", down: "down",
    budget: "Budget", budgetSoon: "available when a budget is loaded",
    lyMissing: "last year not loaded, so compared with the previous period",
    flagMove: (pct: string, amt: string) => `Moved ${pct} (${amt}) against the comparison`,
    flagWrongSide: "On the wrong side: check this account's class or postings",
    flagNew: (amt: string) => `New line: ${amt} where the comparison had nothing`,
    noFlags: "Nothing needs a look: no line moved past the highlight limits.",
    flagged: "Needs a look", flagsOnly: "Show only lines that need a look",
    mark: "Mark this line", markNote: "Note (optional)", clearMark: "Clear mark", saveMark: "Save", marked: (c: string) => `Marked ${c}`,
    colors: { yellow: "yellow", green: "green", blue: "blue", pink: "pink", grey: "grey" } as Record<string, string>,
    thresholds: "Highlights", thresholdsHelp: "A line is flagged when it moves by at least this percentage AND at least this amount against its comparison.",
    pctLabel: "At least (%)", amountLabel: (cur: string) => `And at least (${cur})`, saved: "Saved",
    legend: "Shaded rows are totals. ▲▼ show change; green is better, red is worse. ⚠ needs a look.",
  },
  {
    better: "أفضل", worse: "أسوأ", up: "ارتفاع", down: "انخفاض",
    budget: "الموازنة", budgetSoon: "متاحة عند تحميل موازنة",
    lyMissing: "بيانات العام الماضي غير محملة، لذلك المقارنة بالفترة السابقة",
    flagMove: (pct: string, amt: string) => `تغيّر ${pct} (${amt}) مقارنة بفترة المقارنة`,
    flagWrongSide: "في الجانب الخطأ: راجع تصنيف هذا الحساب أو قيوده",
    flagNew: (amt: string) => `بند جديد: ${amt} ولم يكن له رصيد في فترة المقارنة`,
    noFlags: "لا شيء يحتاج مراجعة: لم يتجاوز أي بند حدود التمييز.",
    flagged: "يحتاج مراجعة", flagsOnly: "إظهار البنود التي تحتاج مراجعة فقط",
    mark: "تمييز هذا البند", markNote: "ملاحظة (اختياري)", clearMark: "إزالة التمييز", saveMark: "حفظ", marked: (c: string) => `مميّز باللون ${c}`,
    colors: { yellow: "الأصفر", green: "الأخضر", blue: "الأزرق", pink: "الوردي", grey: "الرمادي" } as Record<string, string>,
    thresholds: "التمييز", thresholdsHelp: "يُميَّز البند عندما يتغيّر بهذه النسبة على الأقل وبهذا المبلغ على الأقل مقارنة بفترة المقارنة.",
    pctLabel: "على الأقل (%)", amountLabel: (cur: string) => `وعلى الأقل (${cur})`, saved: "تم الحفظ",
    legend: "الصفوف المظللة إجماليات. ▲▼ تبين التغير؛ الأخضر أفضل والأحمر أسوأ. ⚠ يحتاج مراجعة.",
  },
);

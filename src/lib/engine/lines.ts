import type { ClassKey } from "./types";

type Part = { cls: ClassKey; sign: 1 | -1 };
const plus = (...cs: ClassKey[]): Part[] => cs.map((cls) => ({ cls, sign: 1 }));
const minus = (...cs: ClassKey[]): Part[] => cs.map((cls) => ({ cls, sign: -1 }));

const COS = ["cos_variable", "cos_fixed", "cos_depreciation"] as ClassKey[];
const EXP = ["exp_variable", "exp_fixed", "exp_depreciation"] as ClassKey[];
const GP = [...plus("revenue"), ...minus(...COS)];
const OP = [...GP, ...minus(...EXP)];
const EBIT = [...OP, ...plus("other_income"), ...minus("other_expenses")];
const EBT = [...EBIT, ...plus("interest_income"), ...minus("interest_expenses")];
const EAT = [...EBT, ...minus("tax_expenses")];
const TCA = plus("cash", "ar", "inventory", "wip", "other_ca");
const TNCA = plus("fixed_assets", "intangibles", "investments");
const TCL = plus("std", "ap", "tax_liab", "other_cl");
const TNCL = plus("ltd", "other_ncl");
const TE = plus("retained_earnings", "other_equity");

/** Which classes make up each statement line (with the sign they enter it), so any figure can be traced to its accounts. */
export const LINE_PARTS: Record<string, Part[]> = {
  cos: plus(...COS), expenses: plus(...EXP),
  gross_profit: GP, operating_profit: OP, ebit: EBIT, ebt: EBT, eat: EAT, net_income: [...EAT, ...minus("adjustments")],
  tca: TCA, tnca: TNCA, ta: [...TCA, ...TNCA], tcl: TCL, tncl: TNCL, tl: [...TCL, ...TNCL], te: TE, tle: [...TCL, ...TNCL, ...TE],
};

export function lineParts(key: string): Part[] {
  return LINE_PARTS[key] ?? [{ cls: key as ClassKey, sign: 1 }];
}

import { describe, expect, it } from "vitest";
import sample from "../../reference/sample.json";
import { analyze, forecast, type MonthData } from "@/lib/engine";
import { modeOf } from "@/lib/company/mode";

const months = sample.months as MonthData[];
const settings = { currency: sample.currency, fyStartMonth: sample.fy_start_month, taxRate: sample.tax_rate, targets: sample.targets };

/** Simple mode adds a flag and its own engine; a Full company's figures must not move by a cent. */
describe("Full mode is unchanged by Simple mode", () => {
  it("a company with no mode and one set to full both read as Full", () => {
    expect(modeOf({})).toBe("full");
    expect(modeOf({ profile: { mode: "full" } })).toBe("full");
  });
  it("the forecast on the sample company matches the snapshot taken before Simple mode", () => {
    const f = forecast(months, settings);
    expect(JSON.parse(JSON.stringify(f))).toMatchSnapshot();
  });
  it("the analysis of the latest sample month matches the snapshot", () => {
    const a = analyze(months, { type: "month", end: months[months.length - 1].period }, settings);
    expect(JSON.parse(JSON.stringify({ P: a.view.P, K: a.K, findings: a.findings, breakeven: a.breakeven }))).toMatchSnapshot();
  });
});

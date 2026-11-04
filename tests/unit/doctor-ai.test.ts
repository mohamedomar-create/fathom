// "Ask your numbers" and "Explain": the AI words the answer, the company's own figures supply every number. An answer
// with a number the figures don't hold is sent back once with the list of wrong numbers, then refused if still wrong.
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { factsFrom, verifiedAnswer, DoctorAiError } = await import("@/lib/doctor/ai");

const context = { period: "Sep 2026", profit_and_loss: { revenue: "EGP 1,234,568", gross_margin: "38.4%" }, balance_sheet: { cash: "EGP 512,000" }, breakeven: { variable_cost_per_unit_revenue: "0.62" } };

describe("the facts an answer may use", () => {
  it("are every number in the data the AI was given, ratios also as percentages", () => {
    const values = factsFrom(context).map((f) => f.value);
    expect(values).toEqual(expect.arrayContaining([1234568, 38.4, 512000, 0.62]));
    expect(factsFrom(context).find((f) => f.value === 0.62)?.unit).toBe("ratio");
  });
});

describe("a verified answer", () => {
  it("is shown when every number comes from the figures", async () => {
    const call = vi.fn().mockResolvedValue({ answer: "Revenue was EGP 1.23M with a 38% margin; cash is EGP 512,000.", usage: { input_tokens: 10, output_tokens: 5 } });
    const r = await verifiedAnswer({ task: "What was revenue?", context, lang: "en", call });
    expect(r.text).toMatch(/1.23M/);
    expect(call).toHaveBeenCalledTimes(1);
    // The AI got the company's figures and the rule, nothing else.
    const [system, user] = call.mock.calls[0];
    expect(system).toMatch(/only numbers that appear in the data/i);
    expect(user).toContain("1,234,568");
  });

  it("is sent back once with the wrong numbers, and shown if the second try is right", async () => {
    const call = vi.fn()
      .mockResolvedValueOnce({ answer: "Revenue was EGP 2,000,000.", usage: { input_tokens: 10, output_tokens: 5 } })
      .mockResolvedValueOnce({ answer: "Revenue was EGP 1,234,568.", usage: { input_tokens: 10, output_tokens: 5 } });
    const used: number[] = [];
    const r = await verifiedAnswer({ task: "Revenue?", context, lang: "en", call, onUsage: (u) => used.push(u.input_tokens) });
    expect(r.text).toBe("Revenue was EGP 1,234,568.");
    expect(call.mock.calls[1][1]).toMatch(/2,000,000/);
    expect(used).toEqual([10, 10]);
  });

  it("is refused when the numbers are still not the company's", async () => {
    const call = vi.fn().mockResolvedValue({ answer: "Profit was EGP 9,999,999.", usage: { input_tokens: 1, output_tokens: 1 } });
    await expect(verifiedAnswer({ task: "Profit?", context, lang: "en", call })).rejects.toBeInstanceOf(DoctorAiError);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("asks for Arabic when the page is in Arabic, with Western digits kept", async () => {
    const call = vi.fn().mockResolvedValue({ answer: "الإيرادات 1,234,568 جنيه.", usage: { input_tokens: 1, output_tokens: 1 } });
    await verifiedAnswer({ task: "كم الإيرادات؟", context, lang: "ar", call });
    expect(call.mock.calls[0][0]).toMatch(/Arabic/);
  });
});

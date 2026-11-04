// Explain and Ask spend the organisation's AI allowance: like AI commentary, only editors and admins may use them,
// and each one counts against the person's daily AI limit as well as the company's.
import { describe, expect, it } from "vitest";
import { doctorAiLimits, mayUseDoctorAi } from "@/lib/doctor/access";

describe("who may use the doctor's AI", () => {
  it("is editors, admins and owners, never viewers", () => {
    expect(mayUseDoctorAi("viewer")).toBe(false);
    for (const r of ["editor", "admin", "owner"]) expect(mayUseDoctorAi(r)).toBe(true);
  });
  it("counts the person's hourly doctor or ask limit, their daily AI limit and the company's", () => {
    expect(doctorAiLimits("ask", "u1", "c1")).toEqual([["ask", "u1"], ["ai_user", "u1"], ["ai_company", "c1"]]);
    expect(doctorAiLimits("explain", "u1", "c1")[0]).toEqual(["doctor", "u1"]);
  });
});

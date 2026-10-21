import { describe, expect, it } from "vitest";
import { labelStyle } from "@/components/charts/bar-list";

describe("bar value labels stay inside the chart", () => {
  it("a full bar in a list with refunds keeps its label inside on the right", () => expect(labelStyle(50, 100, true)).toEqual({ left: "min(calc(50% + 50% + 6px), calc(100% - 70px))" }));
  it("a full refund bar keeps its label inside on the left", () => expect(labelStyle(50, -100, true)).toEqual({ right: "min(calc(50% + 50% + 6px), calc(100% - 70px))" }));
  it("positive-only lists keep their existing limit", () => expect(labelStyle(100, 5, false)).toEqual({ left: "min(calc(100% + 6px), calc(100% - 70px))" }));
});

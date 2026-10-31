// O9 / O18: a shared report link that can't read its figures says so; one whose period is no longer in the books says so.
import { describe, expect, it } from "vitest";
import { linkState } from "@/lib/report/link-state";

const ends = [{ end: "2026-08" }, { end: "2026-09" }];
describe("linkState", () => {
  it("the main read failing is 'unavailable' (never 'not found')", () => {
    expect(linkState({ mainError: true, found: false, salesError: false, expensesError: false, frozen: false, end: "2026-09", ends })).toEqual({ kind: "unavailable" });
  });
  it("no report for the token is 'not found'", () => {
    expect(linkState({ mainError: false, found: false, salesError: false, expensesError: false, frozen: false, end: "2026-09", ends })).toEqual({ kind: "not_found" });
  });
  it("sales or expenses that couldn't be read are named, the rest of the report shows", () => {
    expect(linkState({ mainError: false, found: true, salesError: true, expensesError: false, frozen: true, end: "2026-09", ends })).toEqual({ kind: "ok", unread: ["sales"], periodGone: false });
  });
  it("a live link whose period is no longer in the books says so; a frozen one keeps its figures", () => {
    expect(linkState({ mainError: false, found: true, salesError: false, expensesError: false, frozen: false, end: "2026-12", ends })).toEqual({ kind: "ok", unread: [], periodGone: true });
    expect(linkState({ mainError: false, found: true, salesError: false, expensesError: false, frozen: true, end: "2026-12", ends })).toEqual({ kind: "ok", unread: [], periodGone: false });
  });
});

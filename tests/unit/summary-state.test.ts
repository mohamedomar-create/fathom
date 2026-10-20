// A page's state from the kept summary: a failure or a summary still being built is never read as "no records".
import { describe, expect, it } from "vitest";
import { fromStateRow, afterError } from "@/lib/company/summary-state";
import { hasFigures, isEmpty, unknownState } from "@/lib/company/loaded";

type D = { rows: number[] };
const EMPTY: D = { rows: [] };
const parse = (raw: unknown) => raw as D;
const none = (d: D) => d.rows.length === 0;
const run = (row: object | null, held: { seq: number | null; builtAt: string | null; data: D } | null = null) => fromStateRow<D>(row, held, parse, EMPTY, none, "AB12CD");

describe("the kept summary's answer", () => {
  it("ready with figures is ready, and is kept with its build", () => {
    const r = run({ status: "ready", summary: { rows: [1] }, built_at: "2026-10-20T10:00:00Z", built_seq: 7 });
    expect(r.state).toMatchObject({ status: "ready", data: { rows: [1] }, builtAt: "2026-10-20T10:00:00Z" });
    expect(r.keep).toMatchObject({ seq: 7 });
  });
  it("ready but with no lines is empty: the only state that invites an upload", () => {
    expect(run({ status: "ready", summary: { rows: [] }, built_seq: 3 }).state.status).toBe("empty");
    expect(run({ status: "empty" }).state.status).toBe("empty");
  });
  it("unchanged since the build the page holds: the held figures, nothing re-sent", () => {
    const held = { seq: 7, builtAt: "t", data: { rows: [5] } };
    const r = run({ status: "ready", same: true, built_seq: 7, built_at: "t" }, held);
    expect(r.state).toMatchObject({ status: "ready", data: { rows: [5] } });
    expect(r.keep).toBeNull();
  });
  it("being rebuilt: pending, with the previous figures when there are any", () => {
    expect(run({ status: "pending", summary: { rows: [2] }, built_at: "t", built_seq: 4 }).state).toMatchObject({ status: "pending", data: { rows: [2] }, builtAt: "t" });
    expect(run({ status: "pending", summary: null }).state).toMatchObject({ status: "pending", data: EMPTY, builtAt: null });
  });
  it("a failed build: the last good figures marked stale, or failed — never empty", () => {
    expect(run({ status: "failed", summary: { rows: [9] }, built_at: "t", error: "57014 canceling statement" }).state).toMatchObject({ status: "stale", code: "57014", ref: "AB12CD" });
    expect(run({ status: "failed", summary: null, error: "57014 x" }).state).toMatchObject({ status: "failed", code: "57014" });
  });
  it("an answer it does not understand is a failure, not no records", () => {
    expect(run(null).state.status).toBe("failed");
    expect(run({ status: "weird" }).state.status).toBe("failed");
  });
});

describe("when the read itself fails", () => {
  it("shows the last good copy as stale with its time, or fails", () => {
    expect(afterError<D>({ seq: 1, builtAt: "t", data: { rows: [1] } }, EMPTY, "R1", "57014")).toMatchObject({ status: "stale", builtAt: "t", ref: "R1" });
    expect(afterError<D>(null, EMPTY, "R2", "57014")).toMatchObject({ status: "failed", data: EMPTY, ref: "R2", code: "57014" });
  });
});

describe("what a page may do with a state", () => {
  it("invites an upload only when empty; treats failed and pending-with-nothing as unknown", () => {
    expect(isEmpty({ status: "failed" })).toBe(false);
    expect(hasFigures({ status: "stale" })).toBe(true);
    expect(unknownState({ status: "failed", data: EMPTY }, (d) => none(d as D))).toBe(true);
    expect(unknownState({ status: "pending", data: EMPTY }, (d) => none(d as D))).toBe(true);
    expect(unknownState({ status: "pending", data: { rows: [1] } }, (d) => none(d as D))).toBe(false);
    expect(unknownState({ status: "empty", data: EMPTY }, (d) => none(d as D))).toBe(false);
  });
});

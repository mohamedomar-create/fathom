import { describe, expect, it } from "vitest";
import { canRetry } from "@/lib/imports/retry";

const now = Date.parse("2026-10-23T12:00:00Z");
const job = (o: Partial<{ status: string; queued_at: string | null; updated_at: string }>) => ({ status: "failed", queued_at: "2026-10-23T10:00:00Z", updated_at: "2026-10-23T10:05:00Z", ...o });

describe("D16: Try again only on a failed job that still holds its rows", () => {
  it("a job that failed while checking or saving can be tried again", () => {
    expect(canRetry(job({}), now)).toBe(true);
  });
  it("a job that failed while preparing (never queued) has had its rows deleted", () => {
    expect(canRetry(job({ queued_at: null }), now)).toBe(false);
  });
  it("a failed job older than 30 days has had its rows cleaned away", () => {
    expect(canRetry(job({ updated_at: "2026-09-20T10:00:00Z" }), now)).toBe(false);
  });
  it("a job that did not fail is never retried", () => {
    expect(canRetry(job({ status: "done" }), now)).toBe(false);
  });
});

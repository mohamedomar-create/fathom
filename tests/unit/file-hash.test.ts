import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { filesFingerprint } from "@/lib/ingest/file-hash";

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("filesFingerprint", () => {
  it("is the SHA-256 of a single file's bytes", async () => {
    expect(await filesFingerprint([bytes("hello")])).toBe(sha("hello"));
  });
  it("does not depend on the order the files were picked", async () => {
    const a = await filesFingerprint([bytes("jan"), bytes("feb")]);
    expect(await filesFingerprint([bytes("feb"), bytes("jan")])).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(sha("jan"));
  });
  it("changes when one byte changes", async () => {
    expect(await filesFingerprint([bytes("jan 100")])).not.toBe(await filesFingerprint([bytes("jan 101")]));
  });
});

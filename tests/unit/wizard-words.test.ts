import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** Every instruction in the upload steps stays short and simple: one line, no long explanations. */
describe("upload instructions are short", () => {
  it("titles, hints, choices and Odoo steps are 90 characters or fewer", () => {
    const src = readFileSync("src/components/settings/upload-wizard.tsx", "utf8");
    const found = [
      ...src.matchAll(/(?:hint|sub|title|next)="([^"]+)"/g),
      ...src.matchAll(/"(Open Odoo[^"]+|Switch to[^"]+|Select all[^"]+|Pick dates[^"]+|Tick[^"]+)"/g),
    ].map((m) => m[1]);
    expect(found.length).toBeGreaterThan(10);
    for (const t of found) expect(t.length, t).toBeLessThanOrEqual(90);
  });
});

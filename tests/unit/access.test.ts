// Membership decides access and fails closed: no guessed role, no edit controls on a failed or missing membership.
import { describe, expect, it } from "vitest";
import { accessFrom, AccessError } from "@/lib/company/access";

describe("access from the membership row", () => {
  it("each real role gets exactly its rights", () => {
    expect(accessFrom({ role: "viewer" }, null)).toEqual({ role: "viewer", readOnly: true, canEdit: false, isAdmin: false });
    expect(accessFrom({ role: "editor" }, null)).toEqual({ role: "editor", readOnly: false, canEdit: true, isAdmin: false });
    expect(accessFrom({ role: "admin" }, null)).toEqual({ role: "admin", readOnly: false, canEdit: true, isAdmin: true });
  });
  it("no membership: not the person's company", () => {
    expect(accessFrom(null, null)).toBe("none");
  });
  it("a membership that could not be read is an error, never a read-write viewer", () => {
    expect(() => accessFrom(null, { code: "57014", message: "timeout" })).toThrow(AccessError);
    expect(() => accessFrom({ role: "owner" }, null)).toThrow(AccessError);
  });
});

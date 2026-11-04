// Someone who runs several organisations picks which one the admin pages manage; the choice is honoured only for an
// organisation they really administer, otherwise the first one they joined.
import { describe, expect, it } from "vitest";
import { pickAdminOrg } from "@/lib/admin/pick";

const rows = [
  { org_id: "o1", created_at: "2026-01-01", name: "First" },
  { org_id: "o2", created_at: "2026-02-01", name: "Second" },
];

describe("the organisation the admin pages manage", () => {
  it("is the one chosen, when the person administers it", () => expect(pickAdminOrg(rows, "o2")?.org_id).toBe("o2"));
  it("is the first joined when nothing (or someone else's organisation) is chosen", () => {
    expect(pickAdminOrg(rows, undefined)?.org_id).toBe("o1");
    expect(pickAdminOrg(rows, "o-not-mine")?.org_id).toBe("o1");
  });
  it("is none for someone who administers nothing", () => expect(pickAdminOrg([], "o1")).toBeNull());
});

// Who the person is in this company, decided from their membership row. Fails closed: a membership that could not be
// read is an error (the page shows its error screen), no membership means the company is not theirs (not found), and
// only a real role is ever used — never a guessed one.
export type Role = "admin" | "editor" | "viewer";
export type Access = { role: Role; readOnly: boolean; canEdit: boolean; isAdmin: boolean };

export class AccessError extends Error {
  constructor(readonly code?: string) { super("The membership could not be checked"); }
}

export function accessFrom(row: { role?: string | null } | null, error: { code?: string; message?: string } | null): Access | "none" {
  if (error) throw new AccessError(error.code);
  if (!row) return "none";
  const role = row.role;
  if (role !== "admin" && role !== "editor" && role !== "viewer") throw new AccessError("UNKNOWN_ROLE");
  return { role, readOnly: role === "viewer", canEdit: role !== "viewer", isAdmin: role === "admin" };
}

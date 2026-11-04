export interface AdminOrgRow { org_id: string; created_at: string; name: string }

/** The organisation the admin pages manage: the one chosen if the person administers it, else the first they joined. */
export function pickAdminOrg(rows: AdminOrgRow[], chosen: string | undefined): AdminOrgRow | null {
  if (!rows.length) return null;
  return rows.find((r) => r.org_id === chosen) ?? [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
}

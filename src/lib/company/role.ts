import "server-only";
import type { getUser } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];
export type CompanyRole = "admin" | "editor" | "viewer";

/**
 * The person's role in this company, as every database check sees it: their organisation role, or the role an admin
 * set for them in this company. Null: no access (not a member, no access to this company, or it could not be read).
 * One call, where reading the company and then the membership took two.
 */
export async function companyRole(supabase: Supa, companyId: string): Promise<CompanyRole | null> {
  const { data, error } = await supabase.rpc("my_company_role", { p_company: companyId });
  if (error) { console.error("company role not read", { code: error.code }); return null; }
  return data === "admin" || data === "editor" || data === "viewer" ? data : null;
}

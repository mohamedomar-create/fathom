import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { getUser } from "@/lib/supabase/server";
import { pickAdminOrg, type AdminOrgRow } from "./pick";

export const ADMIN_ORG_COOKIE = "admin_org";

/** Every organisation the person administers, and the one the admin pages manage now (once per request). */
export const adminOrgs = cache(async (): Promise<{ all: AdminOrgRow[]; current: AdminOrgRow | null }> => {
  const { supabase, user } = await getUser();
  if (!user) return { all: [], current: null };
  const { data } = await supabase.from("memberships").select("org_id, created_at, organizations(name)").eq("user_id", user.id).eq("role", "admin");
  const all = (data ?? []).map((m) => ({ org_id: m.org_id, created_at: m.created_at, name: (m.organizations as unknown as { name: string } | null)?.name ?? "" }));
  return { all, current: pickAdminOrg(all, (await cookies()).get(ADMIN_ORG_COOKIE)?.value) };
});

import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { getUser } from "@/lib/supabase/server";
import { accessFrom, AccessError } from "./access";
import type { CompanyRow } from "@/lib/supabase/database.types";

export interface CompanyMeta { id: string; orgId: string; role: "admin" | "editor" | "viewer"; dataVersion: number; source: string; kpiConfig: unknown; readOnly: boolean; row: CompanyRow }

/**
 * What most Data pages need to know about the company: that the person is a member, their role, and which version of
 * the figures is current. Two small reads, once per request (the full company with every balance is loaded only where
 * the page shows figures).
 */
export const loadCompanyMeta = cache(async (id: string): Promise<CompanyMeta> => {
  if (!isUuid(id)) notFound();
  const { supabase, user } = await getUser();
  if (!user) notFound();
  // A read that failed is an error (the error screen with a retry), not "not found"; no membership is not found.
  // The company and the person's memberships are read at the same time (one round to the database, not two).
  const [{ data: c, error: cErr }, { data: ms, error: mErr }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", id).maybeSingle(),
    supabase.from("memberships").select("role, org_id").eq("user_id", user.id),
  ]);
  if (cErr) throw new AccessError(cErr.code);
  if (!c) notFound();
  const access = accessFrom(mErr ? null : (ms ?? []).find((m) => m.org_id === c.org_id) ?? null, mErr);
  if (access === "none") notFound();
  return { id: c.id, orgId: c.org_id, role: access.role, readOnly: access.readOnly, dataVersion: c.data_version, source: c.source, kpiConfig: c.kpi_config, row: c };
});


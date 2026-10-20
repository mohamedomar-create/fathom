import "server-only";
import { cache } from "react";
import { getUser } from "@/lib/supabase/server";
import { EMPTY_END_USERS, parseEndUsers, type EndUserData } from "./end-users-parse";

/** Agency sales by month, end user and method, with the company's own end-user choices (one call). */
export const loadEndUsers = cache(async (companyId: string): Promise<EndUserData> => {
  const { supabase } = await getUser();
  const { data, error } = await supabase.rpc("end_user_summary", { p_company: companyId });
  if (error) { console.error("end_user_summary", error.message); return EMPTY_END_USERS; }
  return parseEndUsers(data);
});

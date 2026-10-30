import "server-only";
import type { getUser } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof getUser>>["supabase"];

/** The month the company's books are closed through (0043), or null. */
export async function closedThroughOf(supabase: Db, companyId: string): Promise<string | null> {
  const { data } = await supabase.from("companies").select("closed_through").eq("id", companyId).maybeSingle();
  return data?.closed_through ?? null;
}

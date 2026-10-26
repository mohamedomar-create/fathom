import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseResetPreview } from "./reset";

/** Removes stored source files (best effort: a file that can't be removed is counted, never hidden). */
export async function removeFiles(supabase: SupabaseClient, paths: string[]): Promise<number> {
  let failed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const part = paths.slice(i, i + 100);
    // A file already gone is not a failure: only an error from Storage counts.
    const { error } = await supabase.storage.from("imports").remove(part);
    if (error) { console.error("reset: stored files", error.message); failed += part.length; }
  }
  return failed;
}

/** The stored files of every live company in an organisation (read before it is deleted, while they are visible). */
export async function orgFiles(supabase: SupabaseClient, orgId: string): Promise<string[]> {
  const { data: cos } = await supabase.from("companies").select("id").eq("org_id", orgId);
  const files: string[] = [];
  for (const c of cos ?? []) {
    const { data } = await supabase.rpc("data_reset_preview", { p_company: c.id });
    files.push(...(parseResetPreview(data)?.files ?? []));
  }
  return files;
}

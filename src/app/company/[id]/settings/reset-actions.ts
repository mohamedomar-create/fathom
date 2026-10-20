"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import { confirmCount, parseResetPreview, type ResetPreview } from "@/lib/company/reset";

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];
const Id = z.string().uuid();
const Scope = z.enum(["financials", "sales", "expenses", "stock", "payments", "end_users", "all"]);

/** What each module of the company holds, for the confirmation screens. Members only (checked in the database). */
export async function previewReset(companyId: string): Promise<{ ok: true; preview: ResetPreview } | { ok: false; error: string }> {
  if (!Id.safeParse(companyId).success) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { data, error } = await supabase.rpc("data_reset_preview", { p_company: companyId });
  if (error) return { ok: false, error: dbError(error, "previewReset") };
  const preview = parseResetPreview(data);
  return preview ? { ok: true, preview } : { ok: false, error: "The database sent an unexpected answer. Please try again." };
}

/** Removes the company's stored source files (best effort: a file that can't be removed is counted, never hidden). */
async function removeFiles(supabase: Supa, paths: string[]): Promise<number> {
  let failed = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const part = paths.slice(i, i + 100);
    // A file already gone is not a failure: only an error from Storage counts.
    const { error } = await supabase.storage.from("imports").remove(part);
    if (error) { console.error("reset: stored files", error.message); failed += part.length; }
  }
  return failed;
}

/**
 * Clears one module's imported data, or everything ("all"), in one database transaction. `shown` is the record count the
 * person confirmed: if the data changed since, nothing is cleared. One module needs an editor, everything an admin.
 */
export async function clearData(companyId: string, scope: string, shown: number): Promise<{ ok: true; removed: number; filesLeft: number } | { ok: false; error: string }> {
  const s = Scope.safeParse(scope);
  if (!Id.safeParse(companyId).success || !s.success || !Number.isInteger(shown) || shown < 0) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  // The role first, so a viewer's attempt neither runs nor uses up the editors' reset allowance (the database checks it too).
  const { data: co } = await supabase.from("companies").select("org_id").eq("id", companyId).maybeSingle();
  const { data: mem } = co ? await supabase.from("memberships").select("role").eq("org_id", co.org_id).eq("user_id", user.id).maybeSingle() : { data: null };
  if (!mem || mem.role === "viewer") return { ok: false, error: "Only an editor or admin of this company can clear data." };
  if (s.data === "all" && mem.role !== "admin") return { ok: false, error: "Only organisation admins can clear everything." };
  if (await limited(supabase, "reset", companyId)) return { ok: false, error: TOO_MANY };
  const before = await previewReset(companyId);
  if (!before.ok) return before;
  if (confirmCount(before.preview, s.data) !== shown) return { ok: false, error: dbError({ code: "40001", message: "stale" }, "clearData") };
  // The rows first, all or nothing (the database refuses if the data changed); then the stored files they named, so a
  // refused clear never leaves records pointing at files already removed.
  const { error } = await supabase.rpc("clear_company_data", { p_company: companyId, p_scope: s.data, p_confirm: shown });
  if (error) return { ok: false, error: dbError(error, "clearData") };
  const filesLeft = s.data === "stock" || s.data === "all" ? await removeFiles(supabase, before.preview.files) : 0;
  revalidatePath(`/company/${companyId}`, "layout");
  return { ok: true, removed: shown, filesLeft };
}

/** Deletes the company (admins, its name typed exactly) with its stored files; the record of the deletion is kept. */
export async function deleteCompanyFully(companyId: string, name: string): Promise<{ ok: true; filesLeft: number } | { ok: false; error: string }> {
  if (!Id.safeParse(companyId).success || typeof name !== "string" || name.length > 160) return { ok: false, error: "That value isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const before = await previewReset(companyId);
  if (!before.ok) return before;
  if (before.preview.company !== name) return { ok: false, error: "The name typed does not match the company." };
  const { data: co } = await supabase.from("companies").select("org_id").eq("id", companyId).maybeSingle();
  const { data: mem } = co ? await supabase.from("memberships").select("role").eq("org_id", co.org_id).eq("user_id", user.id).maybeSingle() : { data: null };
  if (mem?.role !== "admin") return { ok: false, error: "Only organisation admins can delete a company." };
  if (await limited(supabase, "reset", companyId)) return { ok: false, error: TOO_MANY };
  // Files before the company: removing them needs the company (whose admins may remove its files). Name and role are
  // checked above, so the delete that follows has nothing left to refuse.
  const filesLeft = await removeFiles(supabase, before.preview.files);
  const { error } = await supabase.rpc("delete_company", { p_company: companyId, p_name: name });
  if (error) return { ok: false, error: dbError(error, "deleteCompanyFully") };
  revalidatePath("/companies");
  return { ok: true, filesLeft };
}

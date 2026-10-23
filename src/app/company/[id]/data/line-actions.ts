"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import type { Json } from "@/lib/supabase/database.types";
import { LineEdit, NewLine } from "@/lib/company/line-edit";

type Result = { ok: true } | { ok: false; error: string };
const problem = (e: z.ZodError) => e.issues[0]?.message ?? "That value isn't valid.";
/** The database's own wording when it refuses a value for a reason it states ("a line stays in its month…"). */
const said = (e: { code?: string; message: string }, context: string) =>
  e.code === "22023" && e.message.length < 200 ? e.message.charAt(0).toUpperCase() + e.message.slice(1) + "." : dbError(e, context);
const refresh = (companyId: string) => { revalidatePath(`/company/${companyId}`, "layout"); };

/** A sale or an expense typed into the app (editors). It joins the latest upload that holds its month. */
export async function addLine(companyId: string, input: z.input<typeof NewLine>): Promise<Result> {
  const v = NewLine.safeParse(input);
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false, error: "That company isn't valid." };
  if (!v.success) return { ok: false, error: problem(v.error) };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, v.data.kind, user.id)) return { ok: false, error: TOO_MANY };
  const { error } = await supabase.rpc("add_line", { p_company: companyId, p_kind: v.data.kind, p_line: v.data.line as Json });
  if (error) return { ok: false, error: said(error, "addLine") };
  refresh(companyId);
  return { ok: true };
}

/** One uploaded line changed in place (editors; it stays in its month). */
export async function updateLine(companyId: string, input: z.input<typeof LineEdit>): Promise<Result> {
  const v = LineEdit.safeParse(input);
  if (!v.success) return { ok: false, error: problem(v.error) };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, v.data.kind, user.id)) return { ok: false, error: TOO_MANY };
  const { error } = await supabase.rpc("update_line", { p_kind: v.data.kind, p_id: v.data.id, p_line: v.data.line as Json });
  if (error) return { ok: false, error: said(error, "updateLine") };
  refresh(companyId);
  return { ok: true };
}

/** One uploaded line removed (editors). */
export async function deleteLine(companyId: string, kind: "sales" | "expenses", id: number): Promise<Result> {
  const v = LineEdit.pick({ kind: true, id: true }).safeParse({ kind, id });
  if (!v.success) return { ok: false, error: problem(v.error) };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (await limited(supabase, v.data.kind, user.id)) return { ok: false, error: TOO_MANY };
  const { error } = await supabase.rpc("delete_line", { p_kind: v.data.kind, p_id: v.data.id });
  if (error) return { ok: false, error: said(error, "deleteLine") };
  refresh(companyId);
  return { ok: true };
}

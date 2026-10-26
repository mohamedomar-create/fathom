"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { dbError } from "@/lib/action-error";

type Result = { ok: true } | { ok: false; error: string };
const Id = z.string().uuid();

/** Accept or decline an invitation sent to the signed-in person's confirmed email. */
async function answer(id: string, fn: "accept_invite" | "decline_invite"): Promise<Result> {
  if (!Id.safeParse(id).success) return { ok: false, error: "That invitation isn't valid." };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const { error } = await supabase.rpc(fn, { p_id: id });
  if (error) return { ok: false, error: error.code === "22023" ? error.message : dbError(error, fn) };
  revalidatePath("/companies");
  return { ok: true };
}

export async function acceptInvite(id: string) { return answer(id, "accept_invite"); }
export async function declineInvite(id: string) { return answer(id, "decline_invite"); }

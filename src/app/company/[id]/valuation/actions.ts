"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { companyRole } from "@/lib/company/role";
import { patchSettings } from "@/lib/company/settings-patch";
import { ValuationSettingsSchema } from "@/lib/valuation/settings";
import { PROFILE_KEY } from "@/lib/company/config-keys";

/** Saves the valuation choices for everyone in the company (editors and admins). */
export async function saveValuationSettings(companyId: string, input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false, error: "Invalid company." };
  const v = ValuationSettingsSchema.safeParse(input);
  // The page shows its own words for this one, in the person's language.
  if (!v.success) return { ok: false, error: "badField" };
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const role = await companyRole(supabase, companyId);
  if (role !== "editor" && role !== "admin") return { ok: false, error: "Only an editor or admin of this company can save the assumptions." };
  // Kept under the profile, which the database merges one level deep: other profile settings are left as they are.
  const r = await patchSettings(supabase, companyId, { [PROFILE_KEY]: { valuation: v.data } });
  if (!r.ok) return r;
  revalidatePath(`/company/${companyId}/valuation`, "layout");
  return { ok: true };
}

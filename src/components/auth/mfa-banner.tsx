import Link from "next/link";
import { getUser } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";

/** Whole days until the grace period ends (0 once it has). */
const daysLeft = (iso: string | null | undefined) => Math.max(0, Math.ceil(((iso ? new Date(iso).getTime() : 0) - Date.now()) / 86_400_000));

/** Admins without two-step sign-in are reminded, with the days left before admin actions are refused. */
export async function MfaBanner() {
  const { supabase, user } = await getUser();
  if (!user) return null;
  const [{ data: profile }, { data: admin }, { data: factors }] = await Promise.all([
    supabase.from("profiles").select("mfa_required_from").eq("id", user.id).maybeSingle(),
    supabase.from("memberships").select("org_id").eq("user_id", user.id).eq("role", "admin").limit(1).maybeSingle(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (!admin || factors?.totp?.some((f) => f.status === "verified")) return null;
  const days = daysLeft(profile?.mfa_required_from);
  const t = (await getDict()).access;
  return (
    <div role="note" data-testid="mfa-banner" className={`mb-6 flex flex-wrap items-center gap-3 rounded-lg border p-4 text-[15px] ${days > 0 ? "border-amber bg-amber/10" : "border-red bg-red-bg"}`}>
      <span className="min-w-0 flex-1">{t.mfaBanner(days)}</span>
      <Link href="/account#security" className="rounded bg-brand-d px-4 py-2 text-sm text-white">{t.mfaBannerLink}</Link>
    </div>
  );
}

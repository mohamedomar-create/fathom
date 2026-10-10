import { NextResponse } from "next/server";
import { dbError } from "@/lib/action-error";
import { attachment } from "@/lib/export/company-workbook";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import { getUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** The personal data held about the signed-in user (Law 151/2020 access and portability). Company data has its own export. */
export async function GET() {
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  if (await limited(supabase, `export:user:${user.id}`, 3600, 20)) return NextResponse.json({ error: TOO_MANY }, { status: 429 });
  const [profile, memberships, invites] = await Promise.all([
    supabase.from("profiles").select("email, full_name, created_at").eq("id", user.id).maybeSingle(),
    supabase.from("memberships").select("role, created_at, organizations(name)").eq("user_id", user.id).order("created_at"),
    supabase.from("invites").select("email, role, created_at, accepted_at, organizations(name)").eq("invited_by", user.id).order("created_at"),
  ]);
  const failed = [profile, memberships].find((r) => r.error)?.error;
  if (failed) return NextResponse.json({ error: dbError(failed, "export:me") }, { status: 500 });
  const orgName = (o: unknown) => (o as { name: string } | null)?.name ?? null;
  const body = {
    exported_at: new Date().toISOString(),
    account: { email: user.email, created_at: user.created_at, last_sign_in_at: user.last_sign_in_at ?? null, email_confirmed_at: user.email_confirmed_at ?? null },
    profile: profile.data,
    memberships: (memberships.data ?? []).map((m) => ({ organisation: orgName(m.organizations), role: m.role, joined_at: m.created_at })),
    // Only admins can read invites (RLS); for everyone else this list is empty.
    invitations_sent: (invites.data ?? []).map((i) => ({ email: i.email, organisation: orgName(i.organizations), role: i.role, sent_at: i.created_at, accepted_at: i.accepted_at })),
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": attachment(`my-data-${body.exported_at.slice(0, 10)}.json`), "Cache-Control": "private, no-store" },
  });
}

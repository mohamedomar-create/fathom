import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBar } from "@/components/shell/app-bar";
import { getUser } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";
import { MfaBanner } from "@/components/auth/mfa-banner";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const { data: m } = await supabase.from("memberships").select("org_id, role, organizations(name)").eq("user_id", user.id).eq("role", "admin").order("created_at").limit(1).maybeSingle();
  const dict = await getDict();
  const d = dict.account;
  // Someone who runs no organisation (an invited editor or viewer) is told why, not bounced or shown an error.
  if (!m) return (
    <>
      <AppBar email={user.email ?? ""} active="admin" />
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
        <p className="rounded border border-line bg-band/40 p-4 text-[15px]" data-testid="not-org-admin">{d.notOrgAdmin}</p>
        <Link href="/companies" className="mt-4 inline-block text-sm text-brand-d hover:underline">{d.myCompanies}</Link>
      </div>
    </>
  );
  return (
    <>
      <AppBar email={user.email ?? ""} orgName={(m.organizations as unknown as { name: string } | null)?.name} isAdmin active="admin" />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 md:flex md:gap-8">
        <nav className="mb-6 flex gap-2 md:w-52 md:flex-col">
          <Link href="/companies" className="text-sm text-mute hover:text-ink">{d.myCompanies}</Link>
          <Link href="/admin/organisation" className="rounded px-3 py-2 text-sm hover:bg-band">{d.orgProfile}</Link>
          <Link href="/admin/people" className="rounded px-3 py-2 text-sm hover:bg-band">{d.people}</Link>
          <Link href="/admin/audit" className="rounded px-3 py-2 text-sm hover:bg-band">{dict.access.auditTitle}</Link>
        </nav>
        <div className="min-w-0 flex-1"><MfaBanner />{children}</div>
      </div>
    </>
  );
}

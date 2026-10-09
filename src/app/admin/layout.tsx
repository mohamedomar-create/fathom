import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBar } from "@/components/shell/app-bar";
import { getUser } from "@/lib/supabase/server";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const { data: m } = await supabase.from("memberships").select("org_id, role, organizations(name)").eq("user_id", user.id).eq("role", "admin").order("created_at").limit(1).maybeSingle();
  if (!m) redirect("/companies");
  return (
    <>
      <AppBar email={user.email ?? ""} orgName={(m.organizations as unknown as { name: string } | null)?.name} isAdmin active="admin" />
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 md:flex md:gap-8">
        <nav className="mb-6 flex gap-2 md:w-52 md:flex-col">
          <Link href="/companies" className="text-sm text-mute hover:text-ink">← My companies</Link>
          <Link href="/admin/organisation" className="rounded px-3 py-2 text-sm hover:bg-band">Organisation profile</Link>
          <Link href="/admin/people" className="rounded px-3 py-2 text-sm hover:bg-band">User management</Link>
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </>
  );
}

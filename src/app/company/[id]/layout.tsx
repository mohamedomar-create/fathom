import type { Metadata } from "next";
import { CompanyShell } from "@/components/shell/company-shell";
import { UserMenu } from "@/components/shell/user-menu";
import { loadCompanyBundle } from "@/lib/company/load";
import { getUser } from "@/lib/supabase/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const { supabase } = await getUser();
  const { data } = await supabase.from("companies").select("name").eq("id", id).maybeSingle();
  return { title: data?.name ?? "Company" };
}

export default async function CompanyLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await loadCompanyBundle(id);
  const { user } = await getUser();
  return (
    <CompanyShell company={bundle} right={<UserMenu email={user?.email ?? ""} orgName={bundle.orgName} isAdmin={bundle.role === "admin"} />}>
      {children}
    </CompanyShell>
  );
}

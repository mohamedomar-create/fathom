import Link from "next/link";
import { Logo } from "./logo";
import { UserMenu } from "./user-menu";
import { getDict } from "@/lib/i18n/server";

export async function AppBar({ email, orgName, isAdmin, active }: { email: string; orgName?: string; isAdmin?: boolean; active?: "companies" | "dashboard" | "admin" }) {
  const d = await getDict();
  const tab = (href: string, label: string, key: string) => (
    <Link href={href} className={`rounded px-3 py-1 hover:text-white ${active === key ? "bg-bar-2 text-white" : ""}`}>{label}</Link>
  );
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 bg-bar px-4 text-[13px] text-[#ddd]">
      <Link href="/companies" className="me-3" aria-label={d.shell.companies}><Logo tone="dark" size={22} /></Link>
      {tab("/companies", d.shell.companies, "companies")}
      {tab("/dashboard", d.shell.insights, "dashboard")}
      <div className="ms-auto"><UserMenu email={email} orgName={orgName} isAdmin={isAdmin} /></div>
    </header>
  );
}

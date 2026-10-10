import Link from "next/link";
import { Logo } from "./logo";
import { UserMenu } from "./user-menu";

export function AppBar({ email, orgName, isAdmin, active }: { email: string; orgName?: string; isAdmin?: boolean; active?: "companies" | "dashboard" | "admin" }) {
  const tab = (href: string, label: string, key: string) => (
    <Link href={href} className={`rounded px-3 py-1 hover:text-white ${active === key ? "bg-bar-2 text-white" : ""}`}>{label}</Link>
  );
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center gap-2 bg-bar px-4 text-[13px] text-[#ddd]">
      <Link href="/companies" className="mr-3" aria-label="Companies"><Logo tone="dark" size={22} /></Link>
      {tab("/companies", "Companies", "companies")}
      {tab("/dashboard", "Insights Dashboard", "dashboard")}
      <div className="ml-auto"><UserMenu email={email} orgName={orgName} isAdmin={isAdmin} /></div>
    </header>
  );
}

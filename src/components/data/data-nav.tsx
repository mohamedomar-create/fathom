"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCompany } from "@/lib/company/context";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "", label: "Steps" },
  { href: "/upload", label: "Upload" },
  { href: "/checks", label: "Checks & history" },
  { href: "/readiness", label: "Readiness" },
  { href: "/odoo", label: "Odoo live" },
];

/** The Data section: every upload in one place, in one order, with its checks and history. */
export function DataNav() {
  const c = useCompany();
  const path = usePathname();
  const base = `${c.basePath}/data`;
  return (
    <div className="mb-6">
      <h1 className="mb-1 text-3xl font-light">Data</h1>
      <p className="mb-4 text-mute">The General Ledger is your book of record. Everything else adds detail or checks it, in this order.</p>
      <div className="flex gap-1 overflow-x-auto border-b border-line" data-testid="data-nav">
        {TABS.filter((t) => t.href !== "/odoo" || c.basePath !== "/demo").map((t) => {
          const href = base + t.href;
          const on = t.href ? path.startsWith(href) : path === base;
          return <Link key={t.href} href={href} className={cn("-mb-px shrink-0 border-b-2 px-4 py-2 text-sm", on ? "border-brand-d font-semibold" : "border-transparent text-mute hover:text-ink")}>{t.label}</Link>;
        })}
      </div>
    </div>
  );
}

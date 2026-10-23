"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCompany } from "@/lib/company/context";
import { cn } from "@/lib/cn";
import { useDict } from "@/lib/i18n/context";

const TABS = [
  { href: "", label: "Steps" },
  { href: "/upload", label: "Upload" },
  { href: "/lines", label: "Lines" },
  { href: "/checks", label: "Checks & history" },
  { href: "/readiness", label: "Readiness" },
  { href: "/end-users", label: "End users" },
  { href: "/odoo", label: "Odoo live" },
];

/** Simple mode keeps the steps, the upload, its lines and the history of what was loaded; the ERP tabs are not shown. */
const SIMPLE_TABS = new Set(["", "/upload", "/lines", "/checks"]);

/** The Data section: every upload in one place, in one order, with its checks and history. */
export function DataNav() {
  const c = useCompany();
  const d = useDict().dataNav;
  const path = usePathname();
  const base = `${c.basePath}/data`;
  return (
    <div className="mb-6">
      <h1 className="mb-1 text-3xl font-light">{d.title}</h1>
      <p className="mb-4 text-mute">{d.sub}</p>
      <div className="flex gap-1 overflow-x-auto border-b border-line" data-testid="data-nav">
        {TABS.filter((t) => ((t.href !== "/odoo" && t.href !== "/end-users") || c.basePath !== "/demo") && (c.mode === "simple" ? SIMPLE_TABS.has(t.href) : t.href !== "/lines")).map((t) => {
          const href = base + t.href;
          const on = t.href ? path.startsWith(href) : path === base;
          return <Link prefetch={false} key={t.href} href={href} className={cn("-mb-px shrink-0 border-b-2 px-4 py-2 text-sm", on ? "border-brand-d font-semibold" : "border-transparent text-mute hover:text-ink")}>{d.tabs[t.href] ?? t.label}</Link>;
        })}
      </div>
    </div>
  );
}

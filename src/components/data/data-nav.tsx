"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCompany } from "@/lib/company/context";
import { cn } from "@/lib/cn";
import { useDict } from "@/lib/i18n/context";
import { dataTabs } from "./data-tabs";

/** The Data section: three tabs (Steps, Checks & history, Connections). Upload and Readiness open from Steps. */
export function DataNav() {
  const c = useCompany();
  const d = useDict().dataNav;
  const path = usePathname();
  const base = `${c.basePath}/data`;
  const demo = c.basePath === "/demo";
  const tabs = dataTabs(path, base, demo);
  const active = tabs.find((t) => t.active)?.key;
  const sub = active === "steps"
    ? [{ href: base, label: d.sub2.steps, id: "steps" }, { href: `${base}/readiness`, label: d.sub2.readiness, id: "readiness" }, { href: `${base}/upload`, label: d.sub2.upload, id: "upload" }]
    : active === "connections"
      ? [{ href: `${base}/odoo`, label: d.sub2.odoo, id: "odoo" }, { href: `${base}/end-users`, label: d.sub2.endUsers, id: "end-users" }]
      : [];
  return (
    <div className="mb-6">
      <h1 className="mb-1 text-3xl font-light">{d.title}</h1>
      <p className="mb-4 text-mute">{d.sub}</p>
      <div tabIndex={0} className="flex gap-1 overflow-x-auto border-b border-line" data-testid="data-nav">
        {tabs.map((t) => (
          <Link prefetch={false} key={t.key} href={t.href} aria-current={t.active ? "page" : undefined} data-testid={`data-tab-${t.key}`}
            className={cn("-mb-px shrink-0 border-b-2 px-4 py-2 text-sm", t.active ? "border-brand-d font-semibold" : "border-transparent text-mute hover:text-ink")}>{d.tabs[t.key]}</Link>
        ))}
      </div>
      {sub.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" data-testid="data-subnav">
          {sub.map((s) => {
            const on = s.href === base ? path === base : path.startsWith(s.href);
            return <Link prefetch={false} key={s.id} href={s.href} aria-current={on ? "page" : undefined} data-testid={`data-sub-${s.id}`}
              className={cn("rounded-full px-3 py-1 text-xs", on ? "bg-brand-bg font-semibold text-brand-d" : "text-mute hover:bg-band hover:text-ink")}>{s.label}</Link>;
          })}
        </div>
      )}
    </div>
  );
}

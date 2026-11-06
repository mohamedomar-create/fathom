"use client";
import { useMemo } from "react";
import { useCompany } from "@/lib/company/context";
import { useT } from "@/lib/i18n/use-t";
import { sectorOf, sectorsFor, type Sector } from "./nav";

/** The company's sectors (its modules on, its opened catalog and custom modules) and the one a page belongs to. */
export function useSectors() {
  const c = useCompany();
  // The demo has every built-in module; a company without a role (demo) sees what a viewer would.
  const { lang } = useT();
  const sectors = useMemo(() => sectorsFor(c.modules ?? [], c.role ?? "viewer", c.userId, lang), [c.modules, c.role, c.userId, lang]);
  const of = (rel: string): Sector => { const s = sectorOf(rel); return sectors.find((x) => x.key === s.key) ?? s; };
  return { sectors, sectorOf: of };
}

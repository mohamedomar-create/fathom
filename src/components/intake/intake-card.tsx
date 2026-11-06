"use client";
import Link from "next/link";
import { useCompany } from "@/lib/company/context";
import { useT } from "@/lib/i18n/use-t";

/** The way in for any workbook: shown on Data ▸ Steps above the step-by-step uploads. */
export function IntakeCard() {
  const c = useCompany();
  const { d } = useT();
  if (c.basePath === "/demo" || c.readOnly) return null;
  return (
    <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand-d/30 bg-brand-bg px-5 py-4" data-testid="intake-card">
      <div className="max-w-3xl">
        <h2 className="font-semibold text-brand-d">{d.ink.title}</h2>
        <p className="text-sm">{d.ink.intro}</p>
      </div>
      <Link prefetch={false} href={`${c.basePath}/data/intake`} className="rounded-md bg-brand-d px-5 py-2 font-medium text-white" data-testid="intake-open">{d.ink.drop}</Link>
    </section>
  );
}

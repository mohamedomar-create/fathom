"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { useCompany } from "@/lib/company/context";

/** Analysis built on data that fails an accounting check is flagged on every page until it is fixed or accepted. */
export function HealthBanner() {
  const c = useCompany();
  const path = usePathname();
  const n = c.health?.failing ?? 0;
  if (!n || path.includes("/settings/")) return null;
  return (
    <Link prefetch={false} href={`${c.basePath}/settings/data-health`} className="mt-3 flex items-center gap-2 rounded-md bg-red-bg px-4 py-2 text-[13px] text-red hover:underline no-print" data-testid="health-banner">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {n} accounting check{n > 1 ? "s fail" : " fails"} in this company&apos;s data (for example the balance sheet does not balance). Figures may be wrong: review them in Data health.
    </Link>
  );
}

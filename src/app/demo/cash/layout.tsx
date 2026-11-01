import type { Metadata } from "next";
import { CashShell } from "@/components/cash/cash-shell";
import { CashProvider } from "@/lib/cash/context";
import { demoCashCompany, demoCashEntries } from "@/lib/cash/demo";

export const metadata: Metadata = { title: "Cash book demo" };

/** The public cash book demo: a made-up kiosk, read-only, no sign-in. */
export default function DemoCashLayout({ children }: { children: React.ReactNode }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const company = demoCashCompany(today);
  return (
    <CashShell id="demo" name={company.name} base={company.base} demo>
      <CashProvider value={{ company, entries: demoCashEntries(today) }}>{children}</CashProvider>
    </CashShell>
  );
}

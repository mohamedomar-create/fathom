import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { loadCashCompany, loadCashEntries } from "@/lib/cash/load";
import { CashProvider } from "@/lib/cash/context";
import { CashShell } from "@/components/cash/cash-shell";
import { UserMenu } from "@/components/shell/user-menu";
import { getDict } from "@/lib/i18n/server";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const c = await loadCashCompany(id).catch(() => null);
  return { title: c?.name ?? "Cash book" };
}

/** The cash book's own layout: the business and its entries, nothing else (no balances, checks or summaries). */
export default async function CashLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await loadCashCompany(id);
  // A company on the full system has its own pages.
  if (!company.simple) redirect(`/company/${id}`);
  const [{ user }, loaded, d] = await Promise.all([getUser(), loadCashEntries(id), getDict()]);
  return (
    <CashShell id={id} name={company.name} right={<UserMenu email={user?.email ?? ""} />}>
      {loaded.ok ? <CashProvider value={{ company, entries: loaded.entries }}>{children}</CashProvider> : (
        <div role="alert" className="mx-auto max-w-xl py-16 text-center" data-testid="cash-unavailable">
          <p className="text-lg">{loaded.reason === "update" ? "The cash book needs the latest database update (migration 0037). Ask the site owner to run it." : `${d.state.failedTitle(d.cash.tag)} (ref ${loaded.ref})`}</p>
        </div>
      )}
    </CashShell>
  );
}
export const maxDuration = 60;

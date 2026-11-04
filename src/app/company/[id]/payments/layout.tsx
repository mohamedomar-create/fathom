import { PaymentsProvider } from "@/lib/company/payments-context";
import { loadPayments, noPayments } from "@/lib/company/payments-load";
import { ModuleGate } from "@/components/shell/module-state";
import { statusOf } from "@/lib/company/loaded";
import { loadCompanyBundle } from "@/lib/company/load";
import { loadCashCompany, loadCashEntries } from "@/lib/cash/load";
import { cashOwed } from "@/lib/cash/figures";
import { pack } from "@/lib/wire/pack";

export default async function PaymentsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [payments, c] = await Promise.all([loadPayments(id), loadCompanyBundle(id)]);
  // Books from the cash book and no ageing report: what the cash book marks unpaid is what is owed (shown on Payments).
  let value = payments.data;
  const aged = payments.data.data.aged;
  if (c.booksBasis === "cash" && !aged.receivable && !aged.payable) {
    const [entries, cash] = await Promise.all([loadCashEntries(id), loadCashCompany(id)]);
    if (entries.ok) value = { ...value, cashOwed: { ...cashOwed(entries.entries, cash.today), asOf: cash.today } };
  }
  return <ModuleGate module="payments" state={statusOf(payments, !noPayments(payments.data.data) || !!value.cashOwed?.toYou.total || !!value.cashOwed?.byYou.total)}><PaymentsProvider value={pack(value)}>{children}</PaymentsProvider></ModuleGate>;
}

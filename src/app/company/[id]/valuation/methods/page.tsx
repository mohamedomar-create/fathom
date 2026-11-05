import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { loadCompanyBundle } from "@/lib/company/load";
import { addMonths } from "@/lib/engine/format";
import { valuationEnd } from "@/lib/valuation/inputs";
import { loadValuationPage } from "@/lib/valuation/load";
import { ValueView } from "@/components/value/value-view";

export const metadata: Metadata = { title: "Valuation" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const bundle = await loadCompanyBundle(id);
  const end = valuationEnd(bundle.months);
  const data = await loadValuationPage(id, end ? addMonths(end, -11) : null, end);
  return <ValueView tab="methods" companyId={id} saved={data.settings} topCustomerShare={data.topCustomerShare} />;
}

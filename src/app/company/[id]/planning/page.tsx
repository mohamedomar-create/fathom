import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { getUser } from "@/lib/supabase/server";
import { loadPlans } from "@/lib/company/plan-load";
import { loadSales } from "@/lib/company/sales-load";
import { CompanyPlan } from "@/components/plan/plan-pages";

export const metadata: Metadata = { title: "Business Plan" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase } = await getUser();
  const [set, sales] = await Promise.all([loadPlans(supabase, id), loadSales(id)]);
  return <Suspense><CompanyPlan plans={set.plans} products={sales.data.products} loadError={set.error} /></Suspense>;
}

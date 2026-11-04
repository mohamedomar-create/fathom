import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/ids";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyBundle } from "@/lib/company/load";
import { loadExpenses } from "@/lib/company/expenses-load";
import { decisionsFrom, doctorData } from "@/lib/doctor/load";
import type { Decision } from "@/lib/doctor/findings";
import { DoctorView } from "@/components/doctor/doctor-view";

export const metadata: Metadata = { title: "AI System Doctor" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { supabase } = await getUser();
  const [bundle, expenses, { data: rows, error }] = await Promise.all([
    loadCompanyBundle(id),
    loadExpenses(id),
    supabase.from("doctor_decisions").select("id, finding_key, reason, created_at, amount").eq("company_id", id).is("undone_at", null),
  ]);
  if (error) console.error("doctor decisions not read", { code: error.code, error: error.message });
  // A failed read of the decisions is said on the page (accepting is switched off), never shown as "nothing accepted".
  const decisions: Decision[] | null = error ? null : decisionsFrom(rows ?? []);
  const flags = expenses.status === "ready" || expenses.status === "stale" ? expenses.data.flags : expenses.status === "empty" ? [] : null;
  return <DoctorView data={doctorData(bundle, { flags, decisions })} />;
}

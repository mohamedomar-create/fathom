import { notFound } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { ReportBuilder } from "@/components/report/report-builder";
import { normaliseSections } from "@/lib/report/types";
import type { PeriodType } from "@/lib/engine";

export default async function ReportEditor({ params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const { supabase } = await getUser();
  const { data: r } = await supabase.from("reports").select("*").eq("id", rid).eq("company_id", id).maybeSingle();
  if (!r) notFound();
  const { data: c } = await supabase.from("companies").select("org_id").eq("id", id).single();
  const { data: o } = await supabase.from("organizations").select("name, logo_url, brand_colour, disclaimer, report_footer").eq("id", c!.org_id).single();
  return (
    <ReportBuilder
      report={{ id: r.id, title: r.title, period_type: r.period_type as PeriodType, period_end: r.period_end, sections: normaliseSections(r.sections), status: r.status, share_token: r.share_token }}
      org={{ name: o!.name, logoUrl: o!.logo_url, brandColour: o!.brand_colour, disclaimer: o!.disclaimer, footer: o!.report_footer }}
    />
  );
}

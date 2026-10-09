"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { demoCompany } from "@/lib/company/demo";
import { saveCompanyData } from "@/lib/company/persist";
import { getUser } from "@/lib/supabase/server";

async function editableOrg(orgId?: string | null) {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  const { data } = await supabase.from("memberships").select("org_id, role").eq("user_id", user.id);
  const ok = (data ?? []).filter((m) => m.role !== "viewer");
  const org = ok.find((m) => m.org_id === orgId) ?? ok[0];
  if (!org) throw new Error("You need editor access to an organisation to add companies.");
  return { supabase, user, orgId: org.org_id };
}

const CompanySchema = z.object({
  name: z.string().trim().min(1).max(160),
  currency: z.string().trim().min(1).max(6).default("EGP"),
  fy_start_month: z.coerce.number().int().min(1).max(12).default(1),
  tax_rate: z.coerce.number().min(0).max(99).default(22.5),
  source: z.enum(["upload", "odoo"]).default("upload"),
  org_id: z.string().uuid().optional().or(z.literal("")),
});

export async function createCompany(formData: FormData) {
  const v = CompanySchema.parse(Object.fromEntries(formData));
  const { supabase, user, orgId } = await editableOrg(v.org_id || null);
  const { data, error } = await supabase.from("companies").insert({
    org_id: orgId, name: v.name, currency: v.currency.toUpperCase(), fy_start_month: v.fy_start_month, tax_rate: v.tax_rate / 100, source: v.source, created_by: user.id,
  }).select("id").single();
  if (error) throw new Error(error.message);
  revalidatePath("/companies");
  redirect(`/company/${data.id}/settings/source-data${v.source === "odoo" ? "?tab=odoo" : ""}`);
}

export async function createDemoCompany() {
  const { supabase, user, orgId } = await editableOrg();
  const demo = demoCompany();
  const { data, error } = await supabase.from("companies").insert({
    org_id: orgId, name: `${demo.name} (demo)`, currency: demo.settings.currency, fy_start_month: demo.settings.fyStartMonth,
    tax_rate: demo.settings.taxRate, source: "demo", created_by: user.id,
    kpi_config: { total_revenue: { target: 950000 }, gpm: { target: 40, alert_active: true, alert_threshold: 46 }, profit_ratio: { target: 15 } },
  }).select("id").single();
  if (error) throw new Error(error.message);
  await saveCompanyData(supabase, data.id, demo.accounts.map((a) => ({ code: a.code, name: a.name, cls: a.cls, amounts: a.amounts, mapped_by: "system" })),
    { kind: "demo", filename: "Demo data" }, demo.notes);
  revalidatePath("/companies");
  redirect(`/company/${data.id}/summary`);
}

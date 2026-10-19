import { redirect } from "next/navigation";

/** Moved: the Data section (Upload, or Odoo live). */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; step?: string }> }) {
  const { id } = await params;
  const { tab, step } = await searchParams;
  redirect(tab === "odoo" ? `/company/${id}/data/odoo` : `/company/${id}/data/upload${step ? `?step=${encodeURIComponent(step)}` : ""}`);
}

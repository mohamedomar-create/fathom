import { redirect } from "next/navigation";

/** The budget moved to the Planning screen; old links keep working. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const { v } = await searchParams;
  redirect(`/company/${id}/planning/budget${v ? `?v=${encodeURIComponent(v)}` : ""}`);
}

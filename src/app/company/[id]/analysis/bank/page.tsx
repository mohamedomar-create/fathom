import { redirect } from "next/navigation";

/** Bank Readiness moved to its own sector; old links keep working. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const qs = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  redirect(`/company/${id}/banking${qs.size ? `?${qs}` : ""}`);
}

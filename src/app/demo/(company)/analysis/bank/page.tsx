import { redirect } from "next/navigation";

/** Bank Readiness moved to its own sector; old links keep working. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const qs = new URLSearchParams(Object.entries(await searchParams).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  redirect(`/demo/banking${qs.size ? `?${qs}` : ""}`);
}

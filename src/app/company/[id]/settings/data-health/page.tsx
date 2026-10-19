import { redirect } from "next/navigation";

/** Moved: the Data section's Checks & history. */
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ imported?: string }> }) {
  const { id } = await params;
  const { imported } = await searchParams;
  redirect(`/company/${id}/data/checks${imported ? `?imported=${encodeURIComponent(imported)}` : ""}`);
}

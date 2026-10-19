import { redirect } from "next/navigation";

/** Moved: the Data section's Steps. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  redirect(`/company/${(await params).id}/data`);
}

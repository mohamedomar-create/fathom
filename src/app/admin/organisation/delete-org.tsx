"use client";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteOrganisation } from "../actions";

export function DeleteOrg({ orgId, name, companies, members }: { orgId: string; name: string; companies: number; members: number }) {
  const router = useRouter();
  return (
    <section className="mt-10 rounded-md border border-red/30 p-4">
      <h3 className="font-medium text-red">Danger zone</h3>
      <p className="mb-3 text-sm text-mute">Deleting the organisation removes every company in it, all their data and reports, and everyone&apos;s access.</p>
      <ConfirmDialog title="Delete this organisation?" confirmLabel="Delete organisation" typeToConfirm={name} typeLabel="Type the organisation name" testId="delete-org-dialog"
        onConfirm={async () => {
          const r = await deleteOrganisation(orgId, name);
          if (!r.ok) return r.error ?? "Could not delete the organisation.";
          router.push("/companies");
          router.refresh();
        }}
        trigger={<button className="rounded border border-red px-4 py-2 text-sm text-red hover:bg-red-bg" data-testid="delete-org">Delete organisation</button>}>
        <p>This permanently removes <strong>{name}</strong>, its {companies} {companies === 1 ? "company" : "companies"} with all their financial data, commentary, reports and shared links, and access for {members} {members === 1 ? "person" : "people"}.</p>
        <p className="text-mute">Download each company&apos;s data first (company settings → Profile) if you may need it. This cannot be undone. You will get a new, empty organisation.</p>
      </ConfirmDialog>
    </section>
  );
}

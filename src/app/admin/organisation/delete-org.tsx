"use client";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteOrganisation } from "../actions";
import { useDict } from "@/lib/i18n/context";

export function DeleteOrg({ orgId, name, companies, members }: { orgId: string; name: string; companies: number; members: number }) {
  const router = useRouter();
  const d = useDict().account;
  return (
    <section className="mt-10 rounded-md border border-red/30 p-4">
      <h3 className="font-medium text-red">{d.danger}</h3>
      <p className="mb-3 text-sm text-mute">{d.dangerHelp}</p>
      <ConfirmDialog reauth title={d.deleteOrgTitle} confirmLabel={d.deleteOrg} typeToConfirm={name} typeLabel={d.typeOrg} testId="delete-org-dialog"
        onConfirm={async () => {
          const r = await deleteOrganisation(orgId, name);
          if (!r.ok) return r.error ?? d.couldNotDeleteOrg;
          router.push("/companies");
          router.refresh();
        }}
        trigger={<button className="rounded border border-red px-4 py-2 text-sm text-red hover:bg-red-bg" data-testid="delete-org">{d.deleteOrg}</button>}>
        <p>{d.deleteOrgBody(name, companies, members)}</p>
        <p className="text-mute">{d.deleteOrgLast}</p>
      </ConfirmDialog>
    </section>
  );
}

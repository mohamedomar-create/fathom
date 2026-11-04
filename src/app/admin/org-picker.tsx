"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { chooseAdminOrg } from "./actions";

/** For someone who runs several organisations: which one the admin pages manage. */
export function OrgPicker({ orgs, current, label }: { orgs: { id: string; name: string }[]; current: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="block w-full text-sm">
      <span className="label mb-1 block">{label}</span>
      <select className="w-full rounded border border-line bg-white px-2 py-1.5" value={current} disabled={pending} data-testid="admin-org-picker"
        onChange={(e) => { const id = e.target.value; start(async () => { await chooseAdminOrg(id); router.refresh(); }); }}>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

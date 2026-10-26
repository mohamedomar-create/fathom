"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDict, useLang } from "@/lib/i18n/context";
import { restoreCompany, restoreOrganisation } from "../actions";

export interface Deleted { id: string; name: string; deleted_at: string; kind: "company" | "org" }

/** Companies and organisations deleted in the last 14 days, each with Bring back. */
export function RecentlyDeleted({ items }: { items: Deleted[] }) {
  const t = useDict().access;
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const date = (d: Date) => d.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <section className="mt-10 rounded-md border border-line p-4" data-testid="recently-deleted">
      <h3 className="font-medium">{t.deletedTitle}</h3>
      <p className="mb-3 text-sm text-mute">{t.deletedIntro}</p>
      {!items.length ? <p className="text-sm text-mute">{t.deletedNone}</p> : (
        <ul className="space-y-2">
          {items.map((it) => {
            const at = new Date(it.deleted_at);
            return (
              <li key={it.kind + it.id} className="flex flex-wrap items-center gap-3 rounded border border-line p-3 text-sm" data-testid="deleted-item">
                <div className="min-w-0 flex-1"><div className="font-medium">{it.name}</div>
                  <div className="text-xs text-mute">{t.deletedOn(date(at), date(new Date(at.getTime() + 14 * 86_400_000)))}</div></div>
                <button disabled={pending} data-testid="restore" className="rounded border border-line px-3 py-1.5 hover:bg-band disabled:opacity-50"
                  onClick={() => start(async () => {
                    const r = it.kind === "company" ? await restoreCompany(it.id) : await restoreOrganisation(it.id);
                    setMsg(r.ok ? { ok: true, text: t.restored(it.name) } : { ok: false, text: r.error ?? "" });
                    router.refresh();
                  })}>{t.restore}</button>
              </li>
            );
          })}
        </ul>
      )}
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? "text-green-d" : "text-red"}`}>{msg.text}</p>}
    </section>
  );
}

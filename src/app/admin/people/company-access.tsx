"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useDict } from "@/lib/i18n/context";
import { setCompanyRole } from "../actions";

type Choice = "default" | "editor" | "viewer" | "none";
export interface AccessPerson { userId: string; label: string; role: string }

/** Per company, a member's role when it differs from their organisation role. Admins are never limited. */
export function CompanyAccess({ people, companies, roles }: { people: AccessPerson[]; companies: { id: string; name: string }[]; roles: { company_id: string; user_id: string; role: string }[] }) {
  const d = useDict().account;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);
  const editable = people.filter((p) => p.role !== "admin");
  if (!editable.length) return null;
  return (
    <section className="mt-10" data-testid="company-access">
      <h2 className="text-xl font-light">{d.companyAccess}</h2>
      <p className="mb-4 text-sm text-mute">{d.companyAccessHelp}</p>
      {!companies.length && <p className="text-sm text-mute">{d.noCompanies}</p>}
      {companies.length > 0 && editable.map((p) => (
        <details key={p.userId} className="mb-2 rounded border border-line bg-white p-3" data-testid="company-access-person">
          <summary className="cursor-pointer text-sm font-medium">{p.label}</summary>
          <ul className="mt-3 grid gap-2">
            {companies.map((c) => {
              const key = `${p.userId}|${c.id}`;
              const value = (roles.find((r) => r.user_id === p.userId && r.company_id === c.id)?.role ?? "default") as Choice;
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <label htmlFor={key}>{c.name}</label>
                  <span className="flex items-center gap-2">
                    {msg?.key === key && <span role="status" className={msg.ok ? "text-green-d" : "text-red"}>{msg.text}</span>}
                    <select id={key} value={value} disabled={pending} data-testid={`access-${c.id}`} className="rounded border border-line px-2 py-1"
                      onChange={(e) => {
                        const next = e.target.value as Choice;
                        start(async () => {
                          const r = await setCompanyRole(c.id, p.userId, next === "default" ? null : next);
                          setMsg({ key, ok: r.ok, text: r.ok ? d.accessSaved : r.error ?? "" });
                          if (r.ok) router.refresh();
                        });
                      }}>
                      <option value="default">{d.accessDefault(p.role)}</option>
                      <option value="editor">{d.accessEditor}</option>
                      <option value="viewer">{d.accessViewer}</option>
                      <option value="none">{d.accessNone}</option>
                    </select>
                  </span>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </section>
  );
}

import { getUser } from "@/lib/supabase/server";
import { getDict, getLang } from "@/lib/i18n/server";

/** Every people change in the organisation, newest first (admins only; the database refuses others). */
export default async function AuditPage() {
  const { supabase, user } = await getUser();
  const { data: m } = await supabase.from("memberships").select("org_id").eq("user_id", user!.id).eq("role", "admin").order("created_at").limit(1).maybeSingle();
  if (!m) return null;
  const { data: rows } = await supabase.from("org_audit").select("id, actor, action, target, detail, at").eq("org_id", m.org_id).order("at", { ascending: false }).limit(200);
  const actors = [...new Set((rows ?? []).map((r) => r.actor).filter((x): x is string => !!x))];
  const { data: profiles } = actors.length ? await supabase.from("profiles").select("id, email, full_name").in("id", actors) : { data: [] };
  const who = new Map((profiles ?? []).map((p) => [p.id, p.full_name || p.email]));
  const t = (await getDict()).access;
  const lang = await getLang();
  const when = (iso: string) => new Date(iso).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const detail = (d: unknown) => {
    const o = (d ?? {}) as Record<string, string>;
    return o.from && o.to ? `${o.from} → ${o.to}` : o.role ?? "";
  };
  return (
    <div>
      <h1 className="mb-1 text-3xl font-light">{t.auditTitle}</h1>
      <p className="mb-6 text-mute">{t.auditIntro}</p>
      {!rows?.length ? <p className="text-mute">{t.auditNone}</p> : (
        <table className="tbl text-sm" data-testid="org-audit">
          <thead><tr><th>{t.auditWhen}</th><th>{t.auditWho}</th><th className="text-start">{t.auditWhat}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="row" data-testid="audit-row">
                <td className="whitespace-nowrap">{when(r.at)}</td>
                <td>{(r.actor && who.get(r.actor)) || "–"}</td>
                <td className="text-start">{t.auditActions[r.action] ?? r.action}{r.target ? `: ${r.target}` : ""}{detail(r.detail) ? ` (${detail(r.detail)})` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

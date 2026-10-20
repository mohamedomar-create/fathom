"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cleanHospital, detectAgencies, hospitalKey, money } from "@/lib/engine";
import { parseRegister, resolveEndUsers, type EndUserData } from "@/lib/company/end-users-parse";
import { useCompany } from "@/lib/company/context";
import { removeEndUserChoice, saveEndUserChoices } from "@/app/company/[id]/data/actions";

type Kind = EndUserData["choices"][number]["kind"];

/**
 * The company's own end-user choices, used by Sales ▸ End users: which customers are buying agencies, agency order numbers
 * and their hospitals (for lines Odoo has no link for), and one hospital for two spellings. Nothing here changes a sale;
 * it only says who the end user is.
 */
export function EndUserChoices({ data }: { data: EndUserData }) {
  const c = useCompany();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [agency, setAgency] = useState("");
  const [register, setRegister] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const cur = c.settings.currency;
  const auto = useMemo(() => detectAgencies(data.rows), [data.rows]);
  const a = useMemo(() => resolveEndUsers(data).analysis, [data]);
  const customers = useMemo(() => [...new Set(data.rows.map((r) => r.c))].sort(), [data.rows]);
  const of = (k: Kind) => data.choices.filter((x) => x.kind === k);
  const editable = !c.readOnly;

  const run = (p: Promise<{ ok: boolean; error?: string }>, done: string) => start(async () => {
    const r = await p;
    setMsg(r.ok ? done : r.error ?? "Something went wrong.");
    if (r.ok) router.refresh();
  });
  const save = (items: { kind: Kind; key: string; hospital: string }[], done: string) => run(saveEndUserChoices(c.id, items), done);
  const remove = (kind: Kind, key: string) => run(removeEndUserChoice(c.id, kind, key), "Removed.");
  const parsed = parseRegister(register);

  return (
    <div className="space-y-10" data-testid="end-user-choices">
      <p className="max-w-3xl text-[13.5px] text-mute">
        A buying agency (such as the Unified Procurement Authority) is invoiced for what each hospital ordered. Sales ▸ End users places each
        agency sale on its hospital from Odoo&apos;s own links. These choices fill the gaps Odoo leaves; they never change a sale or its amount.
      </p>
      {msg && <p className="rounded border border-line bg-panel p-2 text-[13.5px]" role="status">{msg}</p>}

      <section>
        <h2 className="mb-1 text-xl font-light">Buying agencies</h2>
        <p className="mb-3 text-[13px] text-mute">Found automatically: a customer whose linked lines go to three or more other end users. Add one Odoo has no links for yet, or mark one as not an agency.</p>
        <ul className="mb-3 text-[13.5px]" data-testid="agency-list">
          {a.agencies.length ? a.agencies.map((n) => (
            <li key={n} className="flex items-center gap-3 py-0.5">
              <span>{n}</span>
              <span className="text-xs text-mute">{auto.includes(n) ? "found automatically" : "added by you"}</span>
              {editable && <button className="text-xs underline" disabled={pending} onClick={() => (auto.includes(n) ? save([{ kind: "not_agency", key: n, hospital: "" }], `${n} is no longer treated as an agency.`) : remove("agency", n))}>Not an agency</button>}
            </li>
          )) : <li className="text-mute">None yet.</li>}
          {of("not_agency").map((x) => <li key={x.key} className="flex gap-3 py-0.5 text-mute"><s>{x.key}</s>{editable && <button className="text-xs underline" disabled={pending} onClick={() => remove("not_agency", x.key)}>Treat as agency again</button>}</li>)}
        </ul>
        {editable && (
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (agency.trim()) save([{ kind: "agency", key: agency.trim(), hospital: "" }], `${agency.trim()} is now treated as an agency.`); }}>
            <input list="eu-customers" value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="Customer name, exactly as invoiced" className="min-w-72 rounded border border-line px-2 py-1 text-sm" aria-label="Agency customer" />
            <datalist id="eu-customers">{customers.map((n) => <option key={n} value={n} />)}</datalist>
            <button className="rounded bg-brand-d px-3 py-1 text-sm text-white" disabled={pending}>Add agency</button>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-xl font-light">Agency order register</h2>
        <p className="mb-3 text-[13px] text-mute">For older invoices with no sales order in Odoo: the agency&apos;s order number as it appears in the line description (for example &quot;PRO 501/22&quot;) and the hospital it was for. A line is placed only when its description contains the number.</p>
        {of("order").length > 0 && (
          <table className="mb-3 w-full max-w-3xl text-[13px]" data-testid="register-table">
            <thead><tr className="label"><th className="py-1 text-start">Order number</th><th className="text-start">Hospital</th><th /></tr></thead>
            <tbody>{of("order").map((x) => <tr key={x.key} className="border-t border-line"><td className="py-1">{x.key}</td><td>{x.hospital}</td><td className="text-end">{editable && <button className="text-xs underline" disabled={pending} onClick={() => remove("order", x.key)}>Remove</button>}</td></tr>)}</tbody>
          </table>
        )}
        {editable && (
          <form onSubmit={(e) => { e.preventDefault(); if (parsed.length) save(parsed.map((p) => ({ kind: "order", ...p })), `${parsed.length} order number${parsed.length === 1 ? "" : "s"} saved.`); }}>
            <textarea value={register} onChange={(e) => setRegister(e.target.value)} rows={4} className="w-full max-w-3xl rounded border border-line p-2 font-mono text-[13px]" placeholder={"PRO 501/22 = مستشفى الرحمة المركزي\nPRO 502/22 = مستشفى السلام الجامعي"} aria-label="Order register lines" />
            <div className="mt-1 flex items-center gap-3"><button className="rounded bg-brand-d px-3 py-1 text-sm text-white" disabled={pending || !parsed.length}>Save {parsed.length || ""} line{parsed.length === 1 ? "" : "s"}</button><span className="text-xs text-mute">One per line: number = hospital (a tab from Excel works too).</span></div>
          </form>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-xl font-light">One hospital, two names</h2>
        <p className="mb-3 text-[13px] text-mute">Spellings that differ only by the agency suffix or by ى/ي, ة/ه are joined automatically. Join any others here.</p>
        {of("alias").length > 0 && (
          <ul className="mb-3 text-[13.5px]">{of("alias").map((x) => <li key={x.key} className="flex gap-3 py-0.5"><span>{x.key}</span><span className="text-mute">→</span><span>{x.hospital}</span>{editable && <button className="text-xs underline" disabled={pending} onClick={() => remove("alias", x.key)}>Undo</button>}</li>)}</ul>
        )}
        {editable && a.hospitals.length > 1 && (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (from && to && from !== to) save([{ kind: "alias", key: hospitalKey(from), hospital: cleanHospital(to) }], `${from} is now counted as ${to}.`); }}>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-line px-2 py-1 text-sm" aria-label="Hospital to join"><option value="">Hospital…</option>{a.hospitals.map((h) => <option key={h.key} value={h.name}>{h.name} ({money(h.amount, cur, true)})</option>)}</select>
            <span className="text-sm">is the same as</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-line px-2 py-1 text-sm" aria-label="Hospital it is"><option value="">Hospital…</option>{a.hospitals.filter((h) => h.name !== from).map((h) => <option key={h.key} value={h.name}>{h.name}</option>)}</select>
            <button className="rounded bg-brand-d px-3 py-1 text-sm text-white" disabled={pending || !from || !to}>Join</button>
          </form>
        )}
      </section>

      {a.unmapped.length > 0 && (
        <section>
          <h2 className="mb-1 text-xl font-light">Still unmapped</h2>
          <p className="mb-3 text-[13px] text-mute">Largest first. Copy an order number from a description into the register above.</p>
          <ul className="max-w-3xl text-[13px]" data-testid="unmapped-preview">{a.unmapped.slice(0, 25).map((u) => <li key={u.text} className="flex justify-between gap-4 border-t border-line py-1"><span className="truncate">{u.text}</span><span className="num shrink-0">{money(u.amount, cur, true)}</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}

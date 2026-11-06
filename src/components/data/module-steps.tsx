"use client";
// Data ▸ Steps, after the built-in steps: one card per module the company opened (HR, CRM, one it built…), each with the
// same three moves as the built-in areas: how to export it, its template, and the upload.
import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { useT } from "@/lib/i18n/use-t";
import { openExtras } from "@/lib/modules/company";
import { moduleByKey } from "@/lib/modules/registry";

export function ModuleSteps() {
  const c = useCompany();
  const { d, lang } = useT();
  const t = d.mods;
  const mods = openExtras(c.modules ?? [], c.role ?? "viewer", c.userId);
  if (!mods.length) return null;
  return (
    <section className="mt-8" data-testid="module-steps">
      <h2 className="t-card mb-1">{t.stepsTitle}</h2>
      <p className="mb-3 text-sm text-mute">{t.stepsSub}</p>
      <ul className="space-y-2">
        {mods.map((r) => {
          const m = moduleByKey(r.key);
          const name = m ? (lang === "ar" ? m.name.ar : m.name.en) : r.name ?? r.key;
          const owns = m ? (lang === "ar" ? m.owns.ar : m.owns.en) : "";
          return (
            <li key={r.key} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-white px-4 py-3" data-testid={`module-step-${r.key}`}>
              <span><b className="font-medium">{name}</b>{owns && <span className="block text-sm text-mute">{owns}</span>}</span>
              <span className="flex flex-wrap items-center gap-2 text-sm">
                <Link prefetch={false} href={`${c.basePath}/modules/${r.key}`} className="text-brand-d underline">{t.howTo}</Link>
                <a href={`/api/templates/module/${r.key}?lang=${lang}${r.key.startsWith("c_") ? `&company=${c.id}` : ""}`} download className="inline-flex items-center gap-1 rounded border border-line px-3 py-1"><Download className="h-3.5 w-3.5" />{t.guide.template}</a>
                {!c.readOnly && <Link prefetch={false} href={`${c.basePath}/data/intake`} className="inline-flex items-center gap-1 rounded bg-brand-d px-3 py-1 text-white"><Upload className="h-3.5 w-3.5" />{t.uploadShort}</Link>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

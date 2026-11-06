"use client";
// How to bring this module's data, the way the built-in areas guide the person: pick the system it comes from (Odoo, SAP,
// Dynamics, or by hand), follow the steps, download the module's own template, then upload. On every module page.
import Link from "next/link";
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { useCompany } from "@/lib/company/context";
import { useT } from "@/lib/i18n/use-t";
import { GUIDE_SYSTEMS, moduleGuide, type GuideSystem } from "@/lib/modules/guide";
import { cn } from "@/lib/cn";

export function ModuleGuide({ module, open: startOpen = true }: { module: string; open?: boolean }) {
  const c = useCompany();
  const { d, lang } = useT();
  const t = d.mods.guide;
  const custom = module.startsWith("c_");
  // A company built its own module from a file: the template route first. Otherwise the system the books come from.
  const [sys, setSys] = useState<GuideSystem>(custom || c.system === "other" ? "excel" : "odoo");
  const [open, setOpen] = useState(startOpen);
  const g = moduleGuide({ key: module }, sys);
  const demo = c.basePath === "/demo";
  const tpl = `/api/templates/module/${module}?lang=${lang}${custom ? `&company=${c.id}` : ""}`;
  return (
    <section className="mb-5 rounded-lg border border-line bg-white px-4 py-3" data-testid="module-guide">
      <button type="button" className="flex w-full items-center justify-between text-start" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="t-card">{t.title}</span><span className="text-sm text-brand-d">{open ? t.hide : t.show}</span>
      </button>
      {open && <>
        <div className="mt-3 flex flex-wrap gap-2" role="tablist" aria-label={t.from}>
          {GUIDE_SYSTEMS.filter((s) => !custom || s === "excel").map((s) => (
            <button key={s} type="button" role="tab" aria-selected={sys === s} data-testid={`guide-${s}`} onClick={() => setSys(s)}
              className={cn("rounded-full border px-3 py-1 text-sm", sys === s ? "border-brand bg-brand-bg text-brand-d" : "border-line")}>{t.systems[s]}</button>
          ))}
        </div>
        <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-[14px]" data-testid="guide-steps">
          {g.steps.map((s) => <li key={s.en}>{lang === "ar" ? s.ar : s.en}</li>)}
        </ol>
        {g.tip && <p className="mt-2 text-sm text-mute">{lang === "ar" ? g.tip.ar : g.tip.en}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={tpl} className="inline-flex items-center gap-2 rounded-md border border-line px-4 py-2 text-sm" data-testid="module-template" download>
            <Download className="h-4 w-4" />{t.template}
          </a>
          {!c.readOnly && !demo && <Link prefetch={false} href={`${c.basePath}/data/intake`} className="inline-flex items-center gap-2 rounded-md bg-brand-d px-4 py-2 text-sm font-medium text-white" data-testid="module-upload">
            <Upload className="h-4 w-4" />{t.upload}
          </Link>}
        </div>
      </>}
    </section>
  );
}

"use client";
// After Add company: the areas whose choice couldn't be saved, named, with the way to set them.
import Link from "next/link";
import { useT } from "@/lib/i18n/use-t";
import { CATALOG } from "@/lib/modules/catalog";

export function AreasMissed({ id, keys }: { id: string; keys: string[] }) {
  const { d, lang } = useT();
  const t = d.mods;
  const name = (k: string) => t.areas[k] ?? (() => { const m = CATALOG.find((x) => x.key === k); return m ? (lang === "ar" ? m.name.ar : m.name.en) : k; })();
  return (
    <div role="alert" className="mb-4 rounded border border-amber/60 bg-amber/10 px-4 py-3 text-sm" data-testid="areas-missed">
      <p>{t.missed(keys.map(name).join(lang === "ar" ? "، " : ", "))}</p>
      <Link prefetch={false} href={`/company/${id}/settings/modules`} className="mt-1 inline-block text-brand-d underline">{t.missedLink}</Link>
    </div>
  );
}

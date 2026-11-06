"use client";
// "What data will you bring?" at setup: the areas a company has. Each one opens as a module with the same steps, checks
// and dashboard; the rest stay closed (built-in ones can be turned back on, catalog ones opened, in Settings ▸ Modules).
import { CATALOG } from "@/lib/modules/catalog";
import { useT } from "@/lib/i18n/use-t";

const CORE = ["financials", "sales", "expenses", "purchasing", "inventory", "payments"];

export function AreasPicker() {
  const { d, lang } = useT();
  const t = d.mods;
  const box = (key: string, label: string, on: boolean) => (
    <label key={key} className="flex items-center gap-2 text-sm" data-testid={`area-${key}`}>
      <input type="checkbox" name="areas" value={key} defaultChecked={on} />{label}
    </label>
  );
  return (
    <fieldset className="sm:col-span-2 rounded border border-line p-3" data-testid="areas-picker">
      <input type="hidden" name="areas_set" value="1" />
      <legend className="label px-1">{t.pick}</legend>
      <p className="mb-2 text-xs text-mute">{t.pickSub}</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {CORE.map((k) => box(k, (t.areas as Record<string, string>)[k], true))}
        {CATALOG.map((m) => box(m.key, lang === "ar" ? m.name.ar : m.name.en, false))}
      </div>
    </fieldset>
  );
}

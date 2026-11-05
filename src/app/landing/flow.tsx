import { CheckCircle2, FileSpreadsheet, Gem, LineChart, Sparkles, Landmark } from "lucide-react";

/**
 * From a messy file to clear answers: the files people already have flow into the engine, which reads, maps and checks
 * them, and out come dashboards, the company's value and a bank pack. The connecting lines move; motion stops with
 * reduced motion.
 */
export function Flow({ files, engine, out, checks }: { files: string[]; engine: string; out: string; checks: string[] }) {
  return (
    <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_auto_1fr]" data-testid="flow">
      <svg className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden>
        {[40, 110, 190, 260].map((y) => <path key={y} d={`M300 ${y} C 400 ${y}, 420 150, 470 150`} fill="none" stroke="#0f8b8d" strokeOpacity=".45" strokeWidth="2" className="lp-flow" />)}
        {[70, 150, 230].map((y) => <path key={y} d={`M530 150 C 580 150, 600 ${y}, 700 ${y}`} fill="none" stroke="#2a78d6" strokeOpacity=".45" strokeWidth="2" className="lp-flow" />)}
      </svg>
      <ul className="relative grid gap-3">
        {files.map((f, i) => (
          <li key={f} className="lp-card lp-rise flex items-center gap-3 rounded-2xl px-4 py-3 shadow-sm" style={{ animationDelay: `${i * 0.1}s`, marginInlineStart: `${(i % 2) * 1.5}rem` }}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-green-bg text-green-d"><FileSpreadsheet className="h-5 w-5" aria-hidden /></span>
            <span className="truncate text-sm font-medium" dir="auto">{f}</span>
          </li>
        ))}
      </ul>
      <div className="relative mx-auto flex flex-col items-center">
        <div className="relative grid h-36 w-36 place-items-center rounded-full bg-gradient-to-br from-brand-d via-[#1d56a6] to-s7 text-white shadow-[0_30px_60px_-20px_rgba(29,86,166,.6)]">
          <span className="absolute inset-0 animate-ping rounded-full bg-brand/20" aria-hidden />
          <Sparkles className="h-10 w-10" aria-hidden />
        </div>
        <div className="mt-4 text-center text-sm font-semibold">{engine}</div>
        <ul className="mt-2 space-y-1 text-xs text-ink-2">
          {checks.slice(0, 3).map((c) => <li key={c} className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green" aria-hidden />{c}</li>)}
        </ul>
      </div>
      <div className="relative grid gap-3">
        {[LineChart, Gem, Landmark].map((Icon, i) => (
          <div key={i} className="lp-card lp-rise flex items-center gap-3 rounded-2xl px-4 py-3 shadow-sm" style={{ animationDelay: `${0.4 + i * 0.12}s`, marginInlineStart: `${(i % 2) * 1.5}rem` }}>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-white ${["bg-brand", "bg-s7", "bg-s1"][i]}`}><Icon className="h-5 w-5" aria-hidden /></span>
            <span className="h-2 flex-1 rounded-full bg-band" aria-hidden><span className="block h-2 rounded-full bg-gradient-to-r from-brand to-s1" style={{ width: `${[78, 62, 88][i]}%` }} /></span>
          </div>
        ))}
        <div className="text-center text-sm font-semibold lg:text-start">{out}</div>
      </div>
    </div>
  );
}

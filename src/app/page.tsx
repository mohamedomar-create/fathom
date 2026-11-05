import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, BadgeCheck, Building2, CheckCircle2, Database, FileSpreadsheet, Gem, Landmark, Languages, LineChart, Lock, PlayCircle, Receipt, ShieldCheck, Sparkles, Stethoscope, Waves } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { SiteFooter } from "@/components/shell/site-footer";
import { AccountDeletedNotice } from "./account-deleted-notice";
import { LangSwitch } from "@/components/shell/lang-switch";
import { getDict, getLang } from "@/lib/i18n/server";
import { landingFigures } from "@/lib/landing/figures";
import { CountUp } from "./landing/count-up";
import { HeroDashboard } from "./landing/hero-dashboard";
import { Showcase } from "./landing/showcase";
import { BentoVisual } from "./landing/bento-visual";

const BENTO = [LineChart, Waves, Gem, Stethoscope, Landmark, Languages];
const BENTO_TINT = ["from-teal-300/40", "from-sky-300/40", "from-violet-300/40", "from-emerald-300/40", "from-amber-200/50", "from-rose-200/50"];
const BENTO_ICON = ["bg-brand", "bg-s1", "bg-s7", "bg-green-d", "bg-[#b07a10]", "bg-[#c2416f]"];

export default async function Home() {
  const dict = await getDict();
  const d = dict.home;
  const l = d.l;
  const lang = await getLang();
  const f = landingFigures();
  return (
    <div className="min-h-screen bg-white text-ink">
      <Suspense><AccountDeletedNotice /></Suspense>

      <header className="sticky top-0 z-30 border-b border-line/70 bg-white/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3.5">
          <span className="text-lg"><Logo size={28} /></span>
          <nav aria-label={d.getStarted} className="ms-auto flex items-center gap-1 text-sm">
            <LangSwitch compact className="px-2 py-2 hover:bg-band" />
            <Link href="/demo/summary" className="hidden rounded-lg px-3 py-2 hover:bg-band sm:inline-block">{d.demo}</Link>
            <Link href="/login" className="rounded-lg px-3 py-2 hover:bg-band">{d.signin}</Link>
            <Link href="/login?mode=signup" className="rounded-lg bg-bar px-4 py-2 font-medium text-white shadow-md hover:bg-bar-2">{d.getStarted}</Link>
          </nav>
        </div>
      </header>
      <div className="lp-hero">

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-16 pt-12 lg:grid-cols-[1fr_1.1fr] lg:pb-24 lg:pt-20">
          <div className="fade-up">
            <div className="lp-glass mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-brand-d"><Sparkles className="h-3.5 w-3.5" aria-hidden />{l.badge}</div>
            <h1 className="text-[42px] font-semibold leading-[1.05] tracking-tight sm:text-[62px]">{l.heroA}<br /><span className="lp-gradient-text">{l.heroB}</span></h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">{l.heroText}</p>

            <div className="mt-8" data-testid="doors">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-mute">{d.doors}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link href="/demo/cash" className="lp-glass group rounded-2xl p-4 transition hover:-translate-y-0.5 hover:shadow-xl" data-testid="door-cash">
                  <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-bg text-brand-d"><Receipt className="h-5 w-5" strokeWidth={1.8} aria-hidden /></span>
                  <div className="font-semibold">{d.doorCash[0]}</div>
                  <p className="mt-1 text-sm text-mute">{d.doorCash[1]}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-d">{d.seeDemo} <ArrowRight className="flip-rtl h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
                </Link>
                <Link href="/demo/summary" className="lp-glass group rounded-2xl p-4 transition hover:-translate-y-0.5 hover:shadow-xl" data-testid="cta-demo">
                  <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#e3ecfb] text-[#1d56a6]"><Building2 className="h-5 w-5" strokeWidth={1.8} aria-hidden /></span>
                  <div className="font-semibold">{d.doorBooks[0]}</div>
                  <p className="mt-1 text-sm text-mute">{d.doorBooks[1]}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-[#1d56a6]">{d.exploreDemo} <ArrowRight className="flip-rtl h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
                </Link>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
                <Link href="/login?mode=signup" className="lp-shine relative rounded-xl bg-gradient-to-r from-brand-d to-[#1d56a6] px-6 py-3 font-semibold text-white shadow-[0_14px_30px_-12px_rgba(11,110,112,.7)] hover:brightness-110" data-testid="door-signup">{d.getStarted}</Link>
                <Link href="/demo/data" className="inline-flex items-center gap-1.5 font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"><FileSpreadsheet className="h-4 w-4" aria-hidden />{d.tryFile}</Link>
              </div>
              <p className="mt-3 text-xs text-mute">{d.tryNote}</p>
            </div>
          </div>
          <HeroDashboard f={f} d={{ ...l, shots: l.shots }} lang={lang} />
        </section>

        <div className="border-y border-white/70 bg-white/50 py-5 backdrop-blur" aria-label={l.worksWith}>
          <p className="mb-3 text-center text-xs font-semibold uppercase tracking-wider text-mute">{l.worksWith}</p>
          <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)]">
            <ul className="lp-marquee text-sm font-medium text-ink-2">
              {[...l.works, ...l.works].map((w, i) => <li key={i} className="flex shrink-0 items-center gap-2" aria-hidden={i >= l.works.length || undefined}><CheckCircle2 className="h-4 w-4 text-brand" aria-hidden />{w}</li>)}
            </ul>
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-6 py-14">
          <dl className="lp-glass grid grid-cols-2 gap-y-8 rounded-3xl p-8 sm:grid-cols-4" data-testid="hero-stats">
            {l.stats.map(([label, n]) => (
              <div key={label} className="flex flex-col px-3 text-center">
                <dt className="order-2 mt-1 text-sm text-mute">{label}</dt>
                <dd className="order-1 text-5xl font-semibold tracking-tight num"><CountUp value={n} className="lp-gradient-text" /></dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <section className="lp-section-mesh py-24" aria-labelledby="show-h">
        <div className="mx-auto max-w-6xl px-6" data-testid="showcase">
          <p className="mb-3 flex items-center justify-center gap-2 text-sm font-semibold text-brand-d"><PlayCircle className="h-4 w-4" aria-hidden />{d.demo}</p>
          <h2 id="show-h" className="mb-3 text-center text-4xl font-semibold tracking-tight sm:text-5xl">{l.showTitle}</h2>
          <p className="mx-auto mb-10 max-w-2xl text-center text-lg text-mute">{l.showText}</p>
          <Showcase lang={lang} shots={l.shots} />
        </div>
      </section>

      <section className="py-24" aria-labelledby="check-h">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-6 lg:grid-cols-2" data-testid="checks">
          <div>
            <h2 id="check-h" className="text-4xl font-semibold tracking-tight sm:text-5xl">{l.checkTitle}</h2>
            <p className="mt-4 max-w-xl text-lg text-mute">{l.checkText}</p>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-ink-2">
              {l.trust.map((x, i) => {
                const Icon = [Lock, ShieldCheck, BadgeCheck][i] ?? Database;
                return <li key={x} className="flex items-center gap-2"><Icon className="h-4 w-4 text-brand-d" aria-hidden />{x}</li>;
              })}
            </ul>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-br from-brand-bg via-white to-[#ece8fb]" aria-hidden />
            <div className="lp-card rounded-2xl p-5 shadow-xl">
              <div className="flex items-center gap-3 border-b border-line pb-4">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-green-bg text-green-d"><FileSpreadsheet className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0"><div className="truncate font-medium" dir="ltr">general_ledger_2026.xlsx</div><div className="text-xs text-mute">{l.checkRows("141,208")}</div></div>
              </div>
              <ul className="mt-4 space-y-3">
                {l.checks.map((c, i) => (
                  <li key={c} className="lp-tick flex items-center gap-3 text-sm" style={{ animationDelay: `${0.15 + i * 0.18}s` }}>
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green" aria-hidden /><span>{c}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-5 rounded-xl bg-green-bg px-4 py-3 text-sm font-medium text-green-d">{l.checkDone}</div>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-section-mesh py-24" aria-labelledby="bento-h">
        <div className="mx-auto max-w-6xl px-6" data-testid="bento">
          <h2 id="bento-h" className="mb-3 text-4xl font-semibold tracking-tight sm:text-5xl">{l.bentoTitle}</h2>
          <p className="mb-12 max-w-2xl text-lg text-mute">{l.bentoText}</p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {l.bento.map(([title, text], i) => {
              const Icon = BENTO[i];
              return (
                <article key={title} className={`lp-card group relative overflow-hidden rounded-3xl p-6 transition hover:-translate-y-1 hover:shadow-2xl ${i === 0 || i === 3 || i === 5 ? "lg:col-span-2" : ""}`}>
                  <div className={`pointer-events-none absolute -end-20 -top-20 h-56 w-56 rounded-full bg-gradient-to-br ${BENTO_TINT[i]} to-transparent blur-2xl transition duration-500 group-hover:scale-125`} aria-hidden />
                  <div className="relative flex items-center justify-between">
                    <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl text-white shadow-md ${BENTO_ICON[i]}`}><Icon className="h-5 w-5" aria-hidden /></span>
                    <span className="rounded-full border border-line bg-white/80 px-2.5 py-1 text-xs font-medium text-ink-2">{l.bentoTag[i]}</span>
                  </div>
                  <h3 className="relative mt-5 text-xl font-semibold">{title}</h3>
                  <p className="relative mt-2 text-mute">{text}</p>
                  <div className="relative"><BentoVisual i={i} f={f} labels={{ gpm: d.gpm, cash: l.cash }} /></div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-24" aria-labelledby="how-h">
        <div className="mx-auto max-w-6xl px-6" data-testid="how">
          <h2 id="how-h" className="mb-14 text-center text-4xl font-semibold tracking-tight sm:text-5xl">{l.howTitle}</h2>
          <ol className="relative grid gap-6 md:grid-cols-3">
            <div className="pointer-events-none absolute inset-x-[16%] top-6 hidden h-px bg-gradient-to-r from-brand via-s1 to-s7 md:block" aria-hidden />
            {l.how.map(([title, text], i) => (
              <li key={title} className="relative text-center">
                <div className="relative mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-brand-d to-[#1d56a6] text-lg font-semibold text-white shadow-lg ring-8 ring-white" aria-hidden>{i + 1}</div>
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="mx-auto mt-2 max-w-xs text-mute">{text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="px-6 pb-24" aria-labelledby="final-h">
        <div className="lp-hero mx-auto max-w-5xl rounded-[2rem] border border-line px-6 py-16 text-center shadow-xl" data-testid="final-cta">
          <span className="lp-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-brand-d"><Sparkles className="h-3.5 w-3.5" aria-hidden />{l.finalBadge}</span>
          <h2 id="final-h" className="mx-auto mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">{l.finalTitle}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-mute">{l.finalText}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/demo/summary" className="lp-shine relative rounded-xl bg-gradient-to-r from-brand-d to-[#1d56a6] px-6 py-3 font-semibold text-white shadow-[0_14px_30px_-12px_rgba(11,110,112,.7)] hover:brightness-110">{d.exploreDemo}</Link>
            <Link href="/login?mode=signup" className="lp-glass rounded-xl px-6 py-3 font-medium hover:bg-white">{d.createAccount}</Link>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}

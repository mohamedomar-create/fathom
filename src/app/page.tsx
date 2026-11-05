import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, BadgeCheck, Building2, Database, Gem, Landmark, Languages, LineChart, Lock, Receipt, ShieldCheck, Sparkles, Stethoscope, Waves } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { SiteFooter } from "@/components/shell/site-footer";
import { AccountDeletedNotice } from "./account-deleted-notice";
import { LangSwitch } from "@/components/shell/lang-switch";
import { getDict, getLang } from "@/lib/i18n/server";
import { landingFigures } from "@/lib/landing/figures";
import { CountUp } from "./landing/count-up";
import { HeroDashboard } from "./landing/hero-dashboard";
import { Showcase } from "./landing/showcase";

const BENTO = [LineChart, Waves, Gem, Stethoscope, Landmark, Languages];
const BENTO_TINT = ["from-teal-400/25", "from-sky-400/25", "from-violet-400/25", "from-emerald-400/25", "from-amber-300/25", "from-rose-300/25"];

export default async function Home() {
  const d = (await getDict()).home;
  const l = d.l;
  const lang = await getLang();
  const f = landingFigures();
  return (
    <div className="min-h-screen bg-white">
      <Suspense><AccountDeletedNotice /></Suspense>

      <div className="lp-hero">
        <header className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-5">
          <span className="text-lg"><Logo size={28} tone="dark" /></span>
          <nav aria-label={d.getStarted} className="ms-auto flex items-center gap-1 text-sm text-white">
            <LangSwitch compact className="px-2 py-2 text-white hover:bg-white/10" />
            <Link href="/demo/summary" className="hidden rounded-lg px-3 py-2 hover:bg-white/10 sm:inline-block">{d.demo}</Link>
            <Link href="/login" className="rounded-lg px-3 py-2 hover:bg-white/10">{d.signin}</Link>
            <Link href="/login?mode=signup" className="rounded-lg bg-white px-4 py-2 font-medium text-bar shadow-lg hover:bg-teal-50">{d.getStarted}</Link>
          </nav>
        </header>

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-[1fr_1.05fr] lg:pb-28 lg:pt-16">
          <div className="fade-up">
            <div className="lp-glass mb-6 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium"><Sparkles className="h-3.5 w-3.5 text-teal-200" aria-hidden />{l.badge}</div>
            <h1 className="text-[42px] font-semibold leading-[1.05] tracking-tight sm:text-[60px]">{l.heroA}<br /><span className="lp-gradient-text">{l.heroB}</span></h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed lp-mute">{l.heroText}</p>

            <div className="mt-8" data-testid="doors">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider lp-mute">{d.doors}</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Link href="/demo/cash" className="lp-glass group rounded-2xl p-4 transition hover:-translate-y-0.5 hover:bg-white/20" data-testid="door-cash">
                  <Receipt className="mb-2 h-6 w-6 text-teal-200" strokeWidth={1.6} aria-hidden />
                  <div className="font-medium">{d.doorCash[0]}</div>
                  <p className="mt-1 text-sm lp-mute">{d.doorCash[1]}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-teal-100">{d.seeDemo} <ArrowRight className="flip-rtl h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
                </Link>
                <Link href="/demo/summary" className="lp-glass group rounded-2xl p-4 transition hover:-translate-y-0.5 hover:bg-white/20" data-testid="cta-demo">
                  <Building2 className="mb-2 h-6 w-6 text-sky-200" strokeWidth={1.6} aria-hidden />
                  <div className="font-medium">{d.doorBooks[0]}</div>
                  <p className="mt-1 text-sm lp-mute">{d.doorBooks[1]}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-sky-100">{d.exploreDemo} <ArrowRight className="flip-rtl h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden /></span>
                </Link>
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-4 text-sm">
                <Link href="/login?mode=signup" className="lp-shine relative rounded-xl bg-gradient-to-r from-teal-300 to-sky-300 px-5 py-2.5 font-semibold text-bar shadow-[0_10px_30px_-10px_rgba(127,240,224,.7)] hover:brightness-105" data-testid="door-signup">{d.getStarted}</Link>
                <Link href="/demo/data" className="text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">{d.tryFile}</Link>
              </div>
              <p className="mt-3 text-xs lp-mute">{d.tryNote}</p>
            </div>
          </div>
          <HeroDashboard f={f} d={l} />
        </section>

        <div className="mx-auto max-w-6xl px-6 pb-14">
          <dl className="lp-glass grid grid-cols-2 gap-y-6 rounded-2xl p-6 sm:grid-cols-4" data-testid="hero-stats">
            {l.stats.map(([label, n]) => (
              <div key={label} className="flex flex-col px-3 text-center">
                <dt className="order-2 mt-1 text-sm lp-mute">{label}</dt>
                <dd className="order-1 text-4xl font-semibold tracking-tight num"><CountUp value={n} /></dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <section className="lp-section-mesh py-20" aria-labelledby="show-h">
        <div className="mx-auto max-w-6xl px-6" data-testid="showcase">
          <h2 id="show-h" className="mb-3 text-center text-4xl font-semibold tracking-tight">{l.showTitle}</h2>
          <p className="mx-auto mb-10 max-w-2xl text-center text-lg text-mute">{l.showText}</p>
          <Showcase lang={lang} shots={l.shots} />
        </div>
      </section>

      <section className="py-20" aria-labelledby="bento-h">
        <div className="mx-auto max-w-6xl px-6" data-testid="bento">
          <h2 id="bento-h" className="mb-3 text-4xl font-semibold tracking-tight">{l.bentoTitle}</h2>
          <p className="mb-10 max-w-2xl text-lg text-mute">{l.bentoText}</p>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {l.bento.map(([title, text], i) => {
              const Icon = BENTO[i];
              return (
                <article key={title} className={`group relative overflow-hidden rounded-2xl border border-line bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,.04)] transition hover:-translate-y-1 hover:shadow-xl ${i === 0 || i === 3 ? "lg:col-span-2" : ""}`}>
                  <div className={`pointer-events-none absolute -end-16 -top-16 h-48 w-48 rounded-full bg-gradient-to-br ${BENTO_TINT[i]} to-transparent blur-2xl transition group-hover:scale-125`} aria-hidden />
                  <div className="relative mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-bar text-white shadow-lg"><Icon className="h-5 w-5" aria-hidden /></div>
                  <h3 className="relative text-xl font-semibold">{title}</h3>
                  <p className="relative mt-2 text-mute">{text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="lp-section-mesh py-20" aria-labelledby="how-h">
        <div className="mx-auto max-w-6xl px-6" data-testid="how">
          <h2 id="how-h" className="mb-10 text-center text-4xl font-semibold tracking-tight">{l.howTitle}</h2>
          <ol className="grid gap-5 md:grid-cols-3">
            {l.how.map(([title, text], i) => (
              <li key={title} className="lp-glass-light relative rounded-2xl p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-sky-600 text-lg font-semibold text-white shadow-lg" aria-hidden>{i + 1}</div>
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="mt-2 text-mute">{text}</p>
              </li>
            ))}
          </ol>
          <ul className="mt-10 flex flex-wrap justify-center gap-x-8 gap-y-3 text-sm text-ink-2">
            {l.trust.map((x, i) => {
              const Icon = [Lock, ShieldCheck, BadgeCheck][i] ?? Database;
              return <li key={x} className="flex items-center gap-2"><Icon className="h-4 w-4 text-brand-d" aria-hidden />{x}</li>;
            })}
          </ul>
        </div>
      </section>

      <section className="lp-hero" aria-labelledby="final-h">
        <div className="mx-auto max-w-4xl px-6 py-20 text-center" data-testid="final-cta">
          <h2 id="final-h" className="text-4xl font-semibold tracking-tight sm:text-5xl">{l.finalTitle}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lg lp-mute">{l.finalText}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/demo/summary" className="lp-shine relative rounded-xl bg-gradient-to-r from-teal-300 to-sky-300 px-6 py-3 font-semibold text-bar shadow-[0_10px_30px_-10px_rgba(127,240,224,.7)]">{d.exploreDemo}</Link>
            <Link href="/login?mode=signup" className="lp-glass rounded-xl px-6 py-3 font-medium text-white hover:bg-white/20">{d.createAccount}</Link>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}

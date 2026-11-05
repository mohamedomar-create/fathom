"use client";
import { useState } from "react";
import Image, { type StaticImageData } from "next/image";
import summaryEn from "../landing-shots/summary-en.jpg";
import summaryAr from "../landing-shots/summary-ar.jpg";
import salesEn from "../landing-shots/sales-en.jpg";
import salesAr from "../landing-shots/sales-ar.jpg";
import valuationEn from "../landing-shots/valuation-en.jpg";
import valuationAr from "../landing-shots/valuation-ar.jpg";
import doctorEn from "../landing-shots/doctor-en.jpg";
import doctorAr from "../landing-shots/doctor-ar.jpg";
import cashEn from "../landing-shots/cash-en.jpg";
import cashAr from "../landing-shots/cash-ar.jpg";
import phoneEn from "../landing-shots/phone-cash-en.jpg";
import phoneAr from "../landing-shots/phone-cash-ar.jpg";
import { cn } from "@/lib/cn";

const SHOTS: Record<string, { en: StaticImageData; ar: StaticImageData }> = {
  summary: { en: summaryEn, ar: summaryAr }, sales: { en: salesEn, ar: salesAr }, valuation: { en: valuationEn, ar: valuationAr },
  doctor: { en: doctorEn, ar: doctorAr }, cash: { en: cashEn, ar: cashAr },
};
const ORDER = ["summary", "sales", "valuation", "doctor", "cash"] as const;

/**
 * Real screens of the product, from the demo company, in the visitor's language: tabs to switch, the chosen screen
 * in a browser frame, and the others as a strip below.
 */
export function Showcase({ lang, shots }: { lang: "en" | "ar"; shots: Record<string, readonly [string, string]> }) {
  const [active, setActive] = useState<(typeof ORDER)[number]>("summary");
  return (
    <div>
      <div role="tablist" aria-label={shots[active][0]} className="mb-6 flex flex-wrap justify-center gap-2">
        {ORDER.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={active === k} onClick={() => setActive(k)} data-testid={`showcase-tab-${k}`}
            className={cn("rounded-full px-4 py-2 text-sm font-medium transition", active === k ? "bg-bar text-white shadow-lg" : "lp-glass text-ink hover:bg-white")}>
            {shots[k][0]}
          </button>
        ))}
      </div>
      {/* A laptop with the chosen screen, and a phone beside it with the cash book. */}
      <div className="relative mx-auto max-w-5xl pb-6 lg:pe-24">
        <div data-testid="showcase-active" data-shot={active}>
          <div className="rounded-t-[1.4rem] border-[10px] border-b-0 border-[#1d2526] bg-[#1d2526] shadow-[0_40px_80px_-30px_rgba(13,53,54,.45)]">
            <div className="flex items-center justify-center pb-1.5 pt-0.5" aria-hidden><span className="h-1.5 w-1.5 rounded-full bg-[#3b4546]" /></div>
            <Image src={SHOTS[active][lang]} alt={shots[active][1]} priority={active === "summary"} sizes="(max-width: 1100px) 100vw, 900px" className="h-auto w-full rounded-sm" placeholder="blur" />
          </div>
          <div className="relative mx-auto h-4 w-[106%] -translate-x-[2.8%] rounded-b-2xl bg-gradient-to-b from-[#d9dedd] to-[#b9c1c0] shadow-lg rtl:translate-x-[2.8%]" aria-hidden>
            <span className="absolute inset-x-0 top-0 mx-auto h-1.5 w-28 rounded-b-lg bg-[#a9b2b1]" />
          </div>
        </div>
        <div className="lp-float absolute -bottom-2 end-0 hidden w-[23%] max-w-[210px] rounded-[2rem] border-[7px] border-[#1d2526] bg-[#1d2526] shadow-2xl lg:block" data-testid="showcase-phone">
          <div className="absolute left-1/2 top-1.5 z-10 h-4 w-16 -translate-x-1/2 rounded-full bg-[#1d2526]" aria-hidden />
          <Image src={lang === "ar" ? phoneAr : phoneEn} alt={shots.cash[1]} sizes="210px" className="h-auto w-full rounded-[1.5rem]" placeholder="blur" />
        </div>
      </div>
      <ul className="mx-auto mt-6 grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-4">
        {ORDER.filter((k) => k !== active).map((k) => (
          <li key={k}>
            <button type="button" onClick={() => setActive(k)} className="group block w-full overflow-hidden rounded-xl border border-white bg-white/60 p-1 text-start shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <Image src={SHOTS[k][lang]} alt={shots[k][1]} sizes="260px" className="h-auto w-full rounded-lg" placeholder="blur" />
              <span className="block px-1.5 py-1 text-xs font-medium text-ink">{shots[k][0]}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";
import { useState } from "react";
import { FileSpreadsheet, ListChecks } from "lucide-react";
import { cn } from "@/lib/cn";

const STEPS = ["Upload", "Check the reading", "Confirm the changes", "Done"];

/** Where the person is in the import: 1 Upload · 2 Check the reading · 3 Confirm the changes · 4 Done. */
export function StepStrip({ at }: { at: 1 | 2 | 3 | 4 }) {
  return (
    <ol className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]" data-testid="step-strip">
      {STEPS.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold", i + 1 < at ? "bg-brand-d text-white" : i + 1 === at ? "bg-ink text-white" : "bg-band text-mute")}>{i + 1}</span>
          <span className={cn(i + 1 === at ? "font-medium" : "text-mute")}>{s}</span>
          {i < STEPS.length - 1 && <span className="text-line">—</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * The two boxes of every upload: the file exactly as it was uploaded on the left, iReport's sorted reading on the right.
 * Side by side on wide screens (each scrolls on its own), two tabs on a phone.
 */
export function TwoBox({ left, right, leftSub, rightSub, rightTone, showFile }: { left: React.ReactNode; right: React.ReactNode; leftSub?: React.ReactNode; rightSub?: React.ReactNode; rightTone?: "ok" | "bad"; showFile?: number }) {
  const [tab, setTab] = useState<"left" | "right">("right");
  // On a phone, a line picked in iReport's reading opens the file tab at its rows.
  const [shownFile, setShownFile] = useState(showFile);
  if (showFile !== shownFile) { setShownFile(showFile); setTab("left"); }
  return (
    <div data-testid="two-box">
      <div className="mb-2 flex rounded-md bg-band p-1 text-sm lg:hidden" role="tablist">
        <button role="tab" aria-selected={tab === "left"} onClick={() => setTab("left")} className={cn("flex-1 rounded px-3 py-1.5", tab === "left" && "bg-white shadow-sm")} data-testid="tab-file">Your file</button>
        <button role="tab" aria-selected={tab === "right"} onClick={() => setTab("right")} className={cn("flex-1 rounded px-3 py-1.5", tab === "right" && "bg-white shadow-sm")} data-testid="tab-reading">What iReport reads</button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={cn("min-w-0 flex-col rounded-lg border border-line bg-white lg:flex", tab === "left" ? "flex" : "hidden")} data-testid="box-file">
          <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <FileSpreadsheet className="h-4 w-4 text-mute" />
            <h2 className="font-medium">Your file</h2>
            <div className="ms-auto text-xs text-mute">{leftSub}</div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col">{left}</div>
        </section>
        <section className={cn("min-w-0 flex-col rounded-lg border-2 bg-white lg:flex", rightTone === "bad" ? "border-red/60" : "border-brand/60", tab === "right" ? "flex" : "hidden")} data-testid="box-reading">
          <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <ListChecks className="h-4 w-4 text-brand-d" />
            <h2 className="font-medium">What iReport reads</h2>
            <div className="ms-auto">{rightSub}</div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col">{right}</div>
        </section>
      </div>
    </div>
  );
}

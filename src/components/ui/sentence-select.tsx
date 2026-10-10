"use client";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface Option<T extends string> { value: T; label: string; hint?: string; disabled?: boolean }

/** Inline dashed-underline selector used in sentence-style controls ("comparing with [Target ▾]"). */
export function SentenceSelect<T extends string>({
  value, options, onChange, label, testId,
}: { value: T; options: Option<T>[]; onChange: (v: T) => void; label?: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="sent-link" data-testid={testId} aria-label={label}>
        {cur?.label ?? value}
        <ChevronDown className="ml-0.5 inline h-3.5 w-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent className="min-w-48">
        {options.map((o) => (
          <button
            key={o.value}
            disabled={o.disabled}
            onClick={() => { onChange(o.value); setOpen(false); }}
            className={cn("flex w-full items-start gap-2 rounded px-2.5 py-1.5 text-left text-sm hover:bg-band disabled:opacity-40", o.value === value && "bg-brand-bg/60")}
          >
            <Check className={cn("mt-0.5 h-4 w-4 shrink-0 text-brand-d", o.value !== value && "invisible")} />
            <span>
              <span className="block">{o.label}</span>
              {o.hint && <span className="block text-xs text-mute">{o.hint}</span>}
            </span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

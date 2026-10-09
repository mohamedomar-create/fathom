"use client";
import { cn } from "@/lib/cn";

export function Chip({ count, label, tone, active, onClick, testId }: { count: number; label: string; tone?: "ok" | "bad" | "warn"; active?: boolean; onClick?: () => void; testId?: string }) {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={cn("inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition", active ? "border-ink bg-white shadow-sm" : "border-line bg-white hover:border-mute")}
    >
      <i className={cn("min-w-5 rounded px-1 text-center not-italic", tone === "ok" ? "bg-green-bg text-green-d" : tone === "bad" ? "bg-red-bg text-red" : tone === "warn" ? "bg-amber/20 text-[#9a6b00]" : "bg-[#eee]")}>{count}</i>
      {label}
    </button>
  );
}

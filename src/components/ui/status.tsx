import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";

export function StatusIcon({ ok, size = "sm" }: { ok: boolean | null; size?: "sm" | "lg" }) {
  if (ok === null) return <span className="text-mute">–</span>;
  const s = size === "lg" ? "h-8 w-8" : "h-[18px] w-[18px]";
  return (
    <span className={cn("inline-flex items-center justify-center rounded-sm text-white", s, ok ? "bg-green" : "bg-red")} aria-label={ok ? "On track" : "Off track"}>
      {ok ? <Check className="h-3/4 w-3/4" strokeWidth={3} /> : <X className="h-3/4 w-3/4" strokeWidth={3} />}
    </span>
  );
}

export function Delta({ value, good, suffix = "%" }: { value: number | null; good?: boolean; suffix?: string }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-mute">–</span>;
  const g = good ?? value >= 0;
  return <span className={g ? "text-green-d" : "text-red"}>{value > 0 ? "▲" : "▼"} {Math.abs(value).toFixed(1)}{suffix}</span>;
}

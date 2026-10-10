import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/cn";

/** The lens mark: a magnifier over rising bars. Same drawing as src/app/icon.svg. */
export function LogoMark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={cn("shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0F8B8D" />
      <circle cx="14" cy="14" r="8" fill="none" stroke="#fff" strokeWidth="2.4" />
      <path d="M20 20l5 5" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M10.5 15.5h2v2.5h-2zM13 13h2v5h-2zM15.5 10.5h2V18h-2z" fill="#DDF1F1" />
    </svg>
  );
}

/** Mark and name. `tone="dark"` for the dark top bar. */
export function Logo({ className, size = 24, tone = "light" }: { className?: string; size?: number; tone?: "light" | "dark" }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", tone === "dark" ? "text-white" : "text-ink", className)}>
      <LogoMark size={size} />
      <span>{APP_NAME}</span>
    </span>
  );
}

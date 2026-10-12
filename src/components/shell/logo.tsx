import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/cn";

/** The report mark: a page with rising bars. Same drawing as src/app/icon.svg. */
export function LogoMark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={cn("shrink-0", className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0F8B8D" />
      <path d="M10.5 5.5h8.5l5 5V25a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 9 25V7a1.5 1.5 0 0 1 1.5-1.5z" fill="#fff" />
      <path d="M19 5.5v3.5a1.5 1.5 0 0 0 1.5 1.5H24z" fill="#9FD6D7" />
      <path d="M11.5 19.5h2.6v4h-2.6zM15.2 16.5h2.6v7h-2.6zM18.9 13.5h2.6v10h-2.6z" fill="#0F8B8D" />
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

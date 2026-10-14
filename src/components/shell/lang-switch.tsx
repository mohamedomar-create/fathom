"use client";
import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LANG_COOKIE } from "@/lib/i18n";
import { useDict, useLang } from "@/lib/i18n/context";
import { cn } from "@/lib/cn";

/** Switches between English and Arabic: the choice is kept on this browser for a year and the page redraws. */
/** `compact`: only the icon on a phone, where the header has no room for the word. */
export function LangSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const lang = useLang();
  const d = useDict();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      lang={lang === "ar" ? "en" : "ar"}
      disabled={pending}
      onClick={() => {
        document.cookie = `${LANG_COOKIE}=${lang === "ar" ? "en" : "ar"}; path=/; max-age=31536000; samesite=lax`;
        start(() => router.refresh());
      }}
      className={cn("inline-flex items-center gap-1.5 rounded px-2 py-1 disabled:opacity-60", className)}
      aria-label={d.lang.switchLabel}
      data-testid="lang-switch"
    >
      <Languages className="h-4 w-4 shrink-0" /><span className={compact ? "hidden sm:inline" : undefined}>{d.lang.switchTo}</span>
    </button>
  );
}

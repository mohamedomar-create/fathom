"use client";
import * as T from "@radix-ui/react-tooltip";
import { useLang } from "@/lib/i18n/context";

export function Tip({ label, children, side }: { label: React.ReactNode; children: React.ReactNode; side?: T.TooltipContentProps["side"] }) {
  // Beside the trigger, on the side the text runs towards (the side rail is on the right in Arabic).
  const toward = useLang() === "ar" ? "left" : "right";
  return (
    <T.Root delayDuration={150}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side ?? toward} sideOffset={6} className="z-50 max-w-xs rounded bg-bar px-2.5 py-1.5 text-xs text-white shadow">
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
export const TipProvider = T.Provider;

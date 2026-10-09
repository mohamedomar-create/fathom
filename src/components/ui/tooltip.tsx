"use client";
import * as T from "@radix-ui/react-tooltip";

export function Tip({ label, children, side = "right" }: { label: React.ReactNode; children: React.ReactNode; side?: T.TooltipContentProps["side"] }) {
  return (
    <T.Root delayDuration={150}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-50 max-w-xs rounded bg-bar px-2.5 py-1.5 text-xs text-white shadow">
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
export const TipProvider = T.Provider;

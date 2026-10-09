"use client";
import * as P from "@radix-ui/react-popover";
import { cn } from "@/lib/cn";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverClose = P.Close;
export function PopoverContent({ className, align = "start", ...props }: P.PopoverContentProps) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={6}
        className={cn("z-50 rounded-md border border-line bg-white p-2 shadow-lg outline-none data-[state=open]:animate-in", className)}
        {...props}
      />
    </P.Portal>
  );
}

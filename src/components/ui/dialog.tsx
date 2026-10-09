"use client";
import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export function DialogContent({ className, children, title, ...props }: D.DialogContentProps & { title: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]" />
      <D.Content
        className={cn("fixed left-1/2 top-1/2 z-50 max-h-[92vh] w-[min(1080px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg bg-white shadow-2xl outline-none", className)}
        {...props}
      >
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
        <D.Close className="absolute right-3 top-3 rounded p-1.5 text-mute hover:bg-band" aria-label="Close"><X className="h-5 w-5" /></D.Close>
      </D.Content>
    </D.Portal>
  );
}

"use client";
import { useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";

/**
 * A form's submit button that sends once: a double-click (or a click while the first is still being saved) is ignored,
 * and the button stays disabled until the server has answered.
 */
export function SubmitOnce({ children, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { pending } = useFormStatus();
  const sent = useRef(false);
  useEffect(() => { if (!pending) sent.current = false; }, [pending]);
  return (
    <button {...rest} type="submit" disabled={disabled || pending} aria-busy={pending || undefined}
      onClick={(e) => { if (sent.current) { e.preventDefault(); return; } sent.current = true; rest.onClick?.(e); }}>
      {children}
    </button>
  );
}

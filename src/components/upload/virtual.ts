"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Draws only the rows in view (big General Ledgers have tens of thousands): fixed row height, a few rows of margin.
 * scrollTo(i) brings row i into view.
 */
export function useWindow(count: number, rowH: number, over = 12) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, h: 600 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setView({ top: el.scrollTop, h: el.clientHeight || 600 });
    on();
    el.addEventListener("scroll", on, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(on) : null;
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", on); ro?.disconnect(); };
  }, []);
  const start = Math.max(0, Math.floor(view.top / rowH) - over);
  const end = Math.min(count, Math.ceil((view.top + view.h) / rowH) + over);
  const scrollTo = useCallback((i: number, offset = 0) => {
    const el = ref.current;
    if (!el) return;
    const y = i * rowH + offset;
    if (y < el.scrollTop + offset || y > el.scrollTop + el.clientHeight - rowH * 2) el.scrollTo({ top: Math.max(0, y - el.clientHeight / 3) });
  }, [rowH]);
  return { ref, start, end, scrollTo };
}

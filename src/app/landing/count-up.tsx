"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A figure that counts up from zero the first time it scrolls into view. The page renders the final value, so
 * without script, in print and with reduced motion the true figure is what shows.
 */
export function CountUp({ value, className }: { value: string; className?: string }) {
  const m = /^(\d+)(.*)$/.exec(value);
  const target = m ? Number(m[1]) : null;
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (target === null || !el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    let frame = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const start = performance.now(), ms = 1100;
      const tick = (t: number) => {
        const k = Math.min(1, (t - start) / ms), eased = 1 - (1 - k) ** 3;
        setShown(`${Math.round(target * eased)}${m![2]}`);
        if (k < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(frame); };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  return <span ref={ref} className={className} data-final={value}>{shown}</span>;
}

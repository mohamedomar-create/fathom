import { cleanNum } from "@/lib/ingest/parse";

/** An amount typed by hand: Arabic digits, "1,200", "1.234,50" and "12,5" read as meant; empty or wordy text is null. */
export function typedAmount(s: string): number | null {
  const t = s.trim();
  if (!t || !/[\d٠-٩]/.test(t)) return null;
  return cleanNum(t);
}

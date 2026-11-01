import { useCallback } from "react";
import { msg } from "./areas/msg";
import { useLang } from "./context";
import type { Lang } from ".";

type Words = typeof msg.en;
type Phrase = { [K in keyof Words]: Words[K] extends (...a: string[]) => string ? K : never }[keyof Words];

/** English message → its key, for the plain (fixed) messages. */
const EXACT = new Map<string, keyof Words>(
  (Object.entries(msg.en) as [keyof Words, unknown][]).filter(([, v]) => typeof v === "string").map(([k, v]) => [v as string, k]),
);

/** Messages that carry values: the pattern finds the values, the Arabic phrase takes them in order. */
const PATTERNS: [RegExp, Phrase][] = [
  [/^Something went wrong \(ref ([A-Z0-9]+)\)\. Please try again\.$/, "somethingRef"],
  [/^That value isn't valid: (.+)$/, "valueReason"],
  [/^PDF export failed \((\d+)\)$/, "pdfStatus"],
  [/^This save covers (\d+) months; at most 600 can be saved at once\.$/, "saveCovers"],
  [/^(\d+) checks? failed\. Fix the mapping, or accept (?:it|them) with a reason\.$/, "checksFailed"],
];

/** A server message in the chosen language: the Arabic when it is known, otherwise the message as sent. */
export function msgIn(lang: Lang, text: string): string {
  if (lang !== "ar" || !text) return text;
  const t = text.trim();
  const k = EXACT.get(t);
  if (k) return msg.ar[k] as string;
  for (const [re, key] of PATTERNS) {
    const m = re.exec(t);
    if (m) return (msg.ar[key] as (...a: string[]) => string)(...m.slice(1));
  }
  return text;
}

/** For client components: `const m = useMsg(); … {m(r.error)}`. */
export function useMsg() {
  const lang = useLang();
  return useCallback((text: string) => msgIn(lang, text), [lang]);
}

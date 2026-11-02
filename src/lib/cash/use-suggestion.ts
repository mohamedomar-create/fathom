"use client";
import { useEffect, useRef, useState } from "react";
import { suggestCategory } from "@/app/cash/[id]/actions";
import { createSuggester, type LearnedRule } from "./categorise";

/**
 * The learned category for what is being typed, asked of the server (every rule the business has, 0049): once the
 * typing pauses, keeping only the newest answer. Null while nothing is known.
 */
export function useSuggestion(companyId: string, direction: "in" | "out", party: string, note: string): LearnedRule | null {
  const [rule, setRule] = useState<LearnedRule | null>(null);
  const ref = useRef<ReturnType<typeof createSuggester> | null>(null);
  useEffect(() => {
    const s = createSuggester(async (i) => { const r = await suggestCategory(companyId, i); return r.ok ? r.rule : null; }, setRule);
    ref.current = s;
    return () => s.stop();
  }, [companyId]);
  useEffect(() => { ref.current?.ask({ direction, party, note }); }, [direction, party, note]);
  return rule;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { suggestCategory } from "@/app/cash/[id]/actions";
import { createSuggester, suggestKey, type LearnedRule, type SuggestInput } from "./categorise";

/**
 * The learned category for what is being typed, asked of the server (every rule the business has, 0049) once the
 * typing pauses. `ready` is true only when the answer is for exactly the words on screen now, so a page never shows or
 * saves an answer meant for a name that has since changed. `epoch` changes when entries are saved (what was learned
 * may have changed): answers are then asked afresh. `check` asks the server now, for a save made before the answer
 * arrived; it throws when the server could not answer.
 */
export function useSuggestion(companyId: string, input: SuggestInput, epoch: number) {
  const [answer, setAnswer] = useState<{ rule: LearnedRule | null; key: string } | null>(null);
  const ref = useRef<ReturnType<typeof createSuggester> | null>(null);
  const latest = useRef(input);
  const { direction, party, note } = input;
  // Kept for the effect below, which asks afresh for the words on screen when the company or the entries change.
  useEffect(() => { latest.current = { direction, party, note }; }, [direction, party, note]);
  useEffect(() => {
    const s = createSuggester(async (i) => {
      const r = await suggestCategory(companyId, i);
      if (!r.ok) throw new Error(r.error);
      return r.rule;
    }, (rule, key) => setAnswer({ rule, key }), 300, companyId);
    ref.current = s;
    s.ask(latest.current);
    return () => s.stop();
  }, [companyId, epoch]);
  useEffect(() => { ref.current?.ask({ direction, party, note }); }, [direction, party, note]);
  const ready = !!answer && answer.key === suggestKey(companyId, input);
  return {
    rule: ready ? answer!.rule : null,
    ready,
    async check(i: SuggestInput): Promise<LearnedRule | null> {
      if (!i.party.trim() && !i.note.trim()) return null;
      const r = await suggestCategory(companyId, i);
      if (!r.ok) throw new Error(r.error);
      return r.rule;
    },
  };
}

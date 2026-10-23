import { checkKey, type Check, type CheckId } from "./checks";

/** A blocking check someone accepted, with the difference it was accepted for. */
export interface AcceptedItem { key: string; title: string; period?: string; reason: string; by: string; at: string; diff?: number }

/** File checks whose failure means the books themselves do not add up: only an admin may accept them. */
export const ADMIN_ONLY = new Set<CheckId>(["tb_zero", "account_rollforward", "cross_check", "continuity"]);

/**
 * Earlier acceptances that still hold for these checks: the same check, statement and month, and the same difference to
 * 1 EGP. A larger (or different) failure needs accepting again. Acceptances saved before differences were kept do not
 * carry into a new upload.
 */
export function stillAccepted(checks: Check[], prev: AcceptedItem[]): AcceptedItem[] {
  const out: AcceptedItem[] = [];
  for (const c of checks) {
    if (c.severity !== "block") continue;
    const key = checkKey(c);
    const p = prev.find((a) => a.key === key && a.diff !== undefined && Math.abs((c.diff ?? 0) - a.diff) <= 1);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * What an import's blocking checks come to: the acceptances carried over, the ones made now (recorded with their
 * difference), and what still blocks. `refused` names a check only an admin may accept that someone else tried to.
 */
export function acceptChecks(checks: Check[], prev: AcceptedItem[], accept: { keys: string[]; reason: string } | undefined, who: { by: string; isAdmin: boolean }, now: string): { accepted: AcceptedItem[]; blocking: Check[]; refused?: string } {
  const carried = stillAccepted(checks, prev);
  const keys = new Set(accept?.keys ?? []);
  const accepted: AcceptedItem[] = [...carried];
  const blocking: Check[] = [];
  let refused: string | undefined;
  for (const c of checks) {
    if (c.severity !== "block" || c.existing) continue;
    const key = checkKey(c);
    if (accepted.some((a) => a.key === key)) continue;
    if (accept && keys.has(key)) {
      if (ADMIN_ONLY.has(c.id) && !who.isAdmin) {
        refused ??= `Only an admin of this company can accept "${c.title}". Fix it in the file, or ask an admin to save this upload.`;
        blocking.push(c);
        continue;
      }
      accepted.push({ key, title: c.title, ...(c.period ? { period: c.period } : {}), reason: accept.reason, by: who.by, at: now, diff: Math.round((c.diff ?? 0) * 100) / 100 });
      continue;
    }
    blocking.push(c);
  }
  return { accepted, blocking, ...(refused ? { refused } : {}) };
}

// What one company has learned about its books, to start another company of the same books from: the class of every
// account (the source's current chart and its people's choices) and its profile (books start, opening date, time zone).
import type { ClassKey } from "@/lib/engine";
import { normLabel } from "@/lib/ingest/parse";
import type { AccountMap, MapEntry } from "./account-map";
import { booksFromZeroOf, booksStartOf, openingAsAtOf, timeZoneOf } from "./time-zone";

export interface CopySource { accounts: { code: string; name: string; cls: ClassKey }[]; map: AccountMap; kpiConfig: unknown }

/**
 * Account-map entries for the target: the source's chart classes by "#code" (by name for an account without a code), its
 * people's choices on top, and none for a key the target's own people already chose. Profile settings the source has.
 */
export function settingsToCopy(src: CopySource, targetMap: AccountMap) {
  const byKey = new Map<string, MapEntry>();
  for (const a of src.accounts) {
    const key = a.code.trim() ? `#${a.code.trim()}` : normLabel(a.name);
    if (key && key.length <= 200) byKey.set(key, { key, cls: a.cls, name: a.name.slice(0, 300) });
  }
  for (const [key, cls] of Object.entries(src.map)) byKey.set(key, { key, cls, name: byKey.get(key)?.name ?? key.replace(/^#/, "") });
  const entries = [...byKey.values()].filter((e) => !(e.key in targetMap));
  const profile = {
    ...(booksStartOf(src.kpiConfig) ? { booksStart: booksStartOf(src.kpiConfig) } : {}),
    ...(openingAsAtOf(src.kpiConfig) ? { openingAsAt: openingAsAtOf(src.kpiConfig) } : {}),
    ...(timeZoneOf(src.kpiConfig) ? { timeZone: timeZoneOf(src.kpiConfig) } : {}),
    booksFromZero: booksFromZeroOf(src.kpiConfig),
  };
  return { entries, profile };
}

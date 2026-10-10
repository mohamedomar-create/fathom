import type { RawLine } from "./extract";

const CODE = /^\d[\d.\-]*$/;

/** "11" is the parent of "1101"; "1-1" of "1-1-01" but not of "1-10". */
function isPrefix(parent: string, child: string) {
  if (child.length <= parent.length || !child.startsWith(parent)) return false;
  return /^\d+$/.test(parent) && /^\d+$/.test(child) ? true : /[.\-]/.test(child[parent.length]);
}

const near = (a: number, b: number, scale: number) => Math.abs(a - b) <= Math.max(1, scale * 1e-6);

/**
 * Charts printed with a code on every level (1 Assets → 11 Fixed assets → 1101 Land), as many Egyptian systems export
 * their trial balance: a coded line whose amounts equal the sum of its direct sub-accounts is a heading, not an account.
 * It is dropped so nothing is counted twice, and its name becomes the section of the accounts under it.
 * A coded line that does not add up to its sub-accounts keeps its own amounts (it has postings of its own).
 */
export function dropParentAccounts(lines: RawLine[]): { lines: RawLine[]; parents: RawLine[] } {
  const parents = new Set<RawLine>();
  const bySheet = new Map<string, RawLine[]>();
  for (const l of lines) if (CODE.test(l.code)) bySheet.set(l.sheet, [...(bySheet.get(l.sheet) ?? []), l]);
  const ancestors = new Map<RawLine, RawLine[]>();
  for (const coded of bySheet.values()) {
    if (coded.length < 3) continue;
    for (const x of coded) {
      const under = coded.filter((c) => c !== x && c.kind === x.kind && isPrefix(x.code, c.code));
      if (!under.length) continue;
      const direct = under.filter((c) => !under.some((y) => y !== c && isPrefix(y.code, c.code)));
      const periods = new Set([...Object.keys(x.values), ...direct.flatMap((c) => Object.keys(c.values))]);
      const sum = (f: (l: RawLine) => number) => direct.reduce((s, c) => s + f(c), 0);
      const scale = Math.max(...[...periods].map((p) => Math.abs(x.values[p] ?? 0)), Math.abs(x.opening), 1);
      const adds = [...periods].every((p) => near(x.values[p] ?? 0, sum((c) => c.values[p] ?? 0), scale))
        && near(x.opening, sum((c) => c.opening), scale)
        && (x.closing === undefined || near(x.closing, sum((c) => c.closing ?? 0), scale));
      if (!adds) continue;
      parents.add(x);
      for (const c of under) ancestors.set(c, [...(ancestors.get(c) ?? []), x]);
    }
  }
  if (!parents.size) return { lines, parents: [] };
  const out = lines.filter((l) => !parents.has(l)).map((l) => {
    const anc = (ancestors.get(l) ?? []).filter((a) => parents.has(a)).sort((a, b) => a.code.length - b.code.length);
    return anc.length && !l.section ? { ...l, section: anc.map((a) => a.name).join(" / ") } : l;
  });
  return { lines: out, parents: [...parents] };
}

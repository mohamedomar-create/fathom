/**
 * A table longer than PostgREST's 1,000-row cap, read in pages: the first page brings the row count, then every other page
 * is fetched at the same time (a ledger's 7,000 balances took seven round trips one after another, seconds on each page).
 * Without a count, pages are read one after another until a short page.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number, withCount: boolean) => Promise<{ rows: T[]; count: number | null }>,
  size = 1000,
): Promise<T[]> {
  const first = await fetchPage(0, size - 1, true);
  if (first.rows.length < size) return first.rows;
  if (first.count === null) {
    const out = [...first.rows];
    for (let from = size; ; from += size) {
      const { rows } = await fetchPage(from, from + size - 1, false);
      out.push(...rows);
      if (rows.length < size) return out;
    }
  }
  const starts: number[] = [];
  for (let from = size; from < first.count; from += size) starts.push(from);
  const rest = await Promise.all(starts.map((from) => fetchPage(from, from + size - 1, false).then((r) => r.rows)));
  const out = first.rows.slice();
  for (const rows of rest) for (const r of rows) out.push(r);
  return out;
}

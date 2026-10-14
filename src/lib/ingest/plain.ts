import type { UploadIssue } from "./sorted";
import { cellRef } from "./trace";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const nameIn = (m: string) => m.match(/"([^"]{1,60})"/)?.[1];

/**
 * One short line for a problem, simple enough for anyone: where it is and what to do.
 * The full message stays available (tooltip, "See all") for the rare case it is needed.
 */
export function plainIssue(i: UploadIssue, origin?: { r: number; c: number }): string {
  const at = i.row !== undefined ? cap(cellRef(i.row, i.col, origin)) : "";
  const m = i.message;
  if (i.fix === "cell") {
    if (/no (invoice date|month)/i.test(m)) return `${cap(cellRef(i.row!, undefined, origin))}: needs a date.`;
    if (/not a date/i.test(m)) return `${at}: must be a date, like 15/01/2026.`;
    if (/not a number/i.test(m)) return `${at}: must be a number.`;
    if (i.classCell || /class/i.test(m)) return `${at}: pick a type from the list.`;
    if (/account name/i.test(m)) return `${at}: needs an account name.`;
    if (/required/i.test(m)) return `${at}: this box can't be empty.`;
    return `${at}: please check this box.`;
  }
  if (i.fix === "class") {
    const n = nameIn(m) ?? "this line";
    return i.severity === "error" ? `Pick a type for "${n}".` : `Check the type of "${n}".`;
  }
  // Settings problems: the first sentence, kept short.
  const first = m.split(/(?<=\.)\s/)[0];
  return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
}

import type { Lang } from "./index";

const ARABIC = /[؀-ۿ]/;

/**
 * Stored text (commentary, a memo) shown only to readers of the language it was written in. The same row serves every
 * reader, so Arabic written by one editor never lands in an English report and the other way round; when the
 * languages differ the page shows its automatic notes instead.
 */
export function inLang(text: string | undefined, lang: Lang): string | undefined {
  if (!text) return undefined;
  return ARABIC.test(text) === (lang === "ar") ? text : undefined;
}

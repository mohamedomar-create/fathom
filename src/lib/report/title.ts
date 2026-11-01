/** The report's default title as stored (English). Readers see it in their own language. */
export const DEFAULT_REPORT_TITLE = "Monthly Performance Report";

/** What to save for a title the person sees: the translated default is stored as the English default. */
export function titleToStore(shown: string, translatedDefault: string): string {
  return shown.trim() === translatedDefault.trim() ? DEFAULT_REPORT_TITLE : shown;
}

import { dict, type Lang } from "@/lib/i18n";

/** One rule for every new password. Supabase Auth enforces the same minimum server-side (project setting). */
export const MIN_PASSWORD = 10;
export const passwordHint = (lang: Lang = "en") => dict(lang).auth.hint(MIN_PASSWORD);
export const PASSWORD_HINT = passwordHint();

/** Why a new password is not acceptable, or null when it is. */
export function passwordProblem(pw: string, lang: Lang = "en"): string | null {
  const d = dict(lang).auth;
  if (pw.length < MIN_PASSWORD) return d.tooShort(MIN_PASSWORD);
  if (pw.length > 72) return d.tooLong;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return d.lettersNumbers;
  return null;
}

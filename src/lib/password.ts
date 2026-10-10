/** One rule for every new password. Supabase Auth enforces the same minimum server-side (project setting). */
export const MIN_PASSWORD = 10;
export const PASSWORD_HINT = `At least ${MIN_PASSWORD} characters, with letters and numbers.`;

/** Why a new password is not acceptable, or null when it is. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 72) return "Use 72 characters or fewer.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Use both letters and numbers.";
  return null;
}

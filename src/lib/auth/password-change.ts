import { MIN_PASSWORD } from "@/lib/password";

export interface PasswordDeps {
  /** True when this person has tried too often (checked before the current password is tested). */
  limited: () => Promise<boolean>;
  /** Whether the current password is right. Must not replace the person's own session. */
  verify: (email: string, password: string) => Promise<boolean>;
  /** Sets the new password; returns the auth service's error text, or null. */
  update: (password: string) => Promise<string | null>;
  signOutOthers: () => Promise<void>;
}

export type PasswordResult = { ok: true } | { ok: false; error: string };

/**
 * Changes the password only after the current one is checked, with a small rate limit so an open session can't be used
 * to guess it. The check runs on a separate client, so the person's own session (and its two-step sign-in) is kept.
 */
export async function changePasswordWith(d: PasswordDeps, email: string, current: string, next: string): Promise<PasswordResult> {
  if (next.length < MIN_PASSWORD || next.length > 200 || !current || current.length > 200) return { ok: false, error: `Use at least ${MIN_PASSWORD} characters.` };
  if (current === next) return { ok: false, error: "Choose a password different from the current one." };
  if (await d.limited()) return { ok: false, error: "Too many tries. Wait 15 minutes and try again." };
  if (!(await d.verify(email, current))) return { ok: false, error: "The current password is not right." };
  const failed = await d.update(next);
  if (failed) {
    console.warn(JSON.stringify({ level: "warn", event: "password_change_failed", detail: failed.slice(0, 200) }));
    return { ok: false, error: /weak|pwned|leaked|compromised/i.test(failed) ? "Choose a stronger password: this one is too common or has appeared in a data leak." : "The password could not be changed just now. Try again." };
  }
  await d.signOutOthers();
  return { ok: true };
}

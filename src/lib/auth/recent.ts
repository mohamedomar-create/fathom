/** How long a sign-in counts as fresh for a destructive action (deleting, clearing, moving, removing people). */
export const RECENT_S = 300;

export interface Claims { amr?: { method: string; timestamp: number }[]; aal?: string }

/** Ways of signing in that prove who the person is on their own; a two-step code (totp) only adds to one of them. */
const PROOF = new Set(["password", "otp", "magiclink", "recovery", "email/signup", "invite"]);

/** When the person last signed in with a password or an email link, in seconds (0: never in this session). */
export const lastSignIn = (c: Claims) => Math.max(0, ...(c.amr ?? []).filter((a) => PROOF.has(a.method)).map((a) => a.timestamp));

export const signedInRecently = (c: Claims, nowS: number, within = RECENT_S) => lastSignIn(c) > 0 && nowS - lastSignIn(c) <= within;

/** How long a sign-in counts as fresh for a destructive action (deleting, clearing, moving, removing people). */
export const RECENT_S = 300;

export interface Claims { amr?: { method: string; timestamp: number }[]; aal?: string }

/** When the person last proved who they are (password, code or link), in seconds. */
export const lastSignIn = (c: Claims) => Math.max(0, ...(c.amr ?? []).map((a) => a.timestamp));

export const signedInRecently = (c: Claims, nowS: number, within = RECENT_S) => lastSignIn(c) > 0 && nowS - lastSignIn(c) <= within;

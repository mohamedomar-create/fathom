/** Supabase's assurance levels for a session: aal1 after the password, aal2 after the two-step code too. */
export interface Levels { currentLevel: string | null; nextLevel: string | null }

/** True when the person has two-step sign-in on but this session entered only the password. */
export const codeStillNeeded = (l: Levels | null | undefined) => l?.nextLevel === "aal2" && l.currentLevel !== "aal2";

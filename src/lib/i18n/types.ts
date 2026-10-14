/** A dictionary's shape with every phrase widened to string, so the other language can fill it with its own words. */
export type Widen<T> = T extends (...a: infer A) => infer R ? (...a: A) => R : T extends string ? string : T extends readonly [string, string] ? readonly [string, string] : { [K in keyof T]: Widen<T[K]> };

/** An area of the app in both languages, written side by side: Arabic must have every English key. */
export const area = <T>(en: T, ar: Widen<T>) => ({ en, ar });

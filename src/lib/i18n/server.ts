import "server-only";
import { cookies } from "next/headers";
import { dict, LANG_COOKIE, parseLang, type Lang } from ".";

/** The language chosen on this browser (English when none is set). */
export async function getLang(): Promise<Lang> {
  return parseLang((await cookies()).get(LANG_COOKIE)?.value);
}

/** The chosen language's words, for server components. */
export async function getDict() {
  return dict(await getLang());
}

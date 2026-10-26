import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { databaseSchema, healthAnswer } from "@/lib/schema";

export const dynamic = "force-dynamic";

/**
 * For the uptime monitor: is the database reachable, and at the version this app needs? No data, no sign-in; answers
 * within about two seconds.
 */
export async function GET() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const state = await Promise.race([
    databaseSchema(supabase).catch(() => ({ db: false, schema: null })),
    new Promise<{ db: boolean; schema: number | null }>((r) => setTimeout(() => r({ db: false, schema: null }), 2000)),
  ]);
  const { status, body } = healthAnswer(state);
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

import { after, NextResponse } from "next/server";
import { z } from "zod";
import { clientWithToken, getUser } from "@/lib/supabase/server";
import { readJobOnServer, stageJobOnServer, type StageDb, type StageJob } from "@/lib/imports/server-stage";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ mappings: z.record(z.string().uuid(), z.record(z.string().max(40), z.string().max(200))).optional() });

/**
 * Hands an import over to the server once its original files are uploaded: the server reads them from storage and sends
 * their rows to the database, then queues the job. It answers at once and carries on after the answer, so the page can
 * be closed. Everything runs with the signed-in person's own access, as from the browser.
 */
export async function POST(req: Request, ctx: { params: Promise<{ job: string }> }) {
  const { job } = await ctx.params;
  if (!z.string().uuid().safeParse(job).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const { data: row } = await supabase.from("import_jobs").select("id, status").eq("id", job).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (row.status !== "preparing") return NextResponse.json({ error: "This import is no longer open." }, { status: 409 });

  // The work below outlives this request: it runs as the same person, on their token rather than the request's cookies.
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) return NextResponse.json({ error: "Please sign in" }, { status: 401 });
  const own = clientWithToken(auth.session.access_token);
  const db: StageDb = {
    job: async (id) => {
      const { data: j } = await own.from("import_jobs").select("id, status, options").eq("id", id).maybeSingle();
      if (!j) return null;
      const { data: files } = await own.from("import_files").select("id, filename, export_key, storage_path, stored").eq("job_id", id).order("created_at");
      return { id: j.id, status: j.status, options: (j.options ?? {}) as StageJob["options"], files: files ?? [] };
    },
    download: async (path) => {
      const { data, error } = await own.storage.from("imports").download(path);
      if (error || !data) throw new Error(`The stored file could not be read: ${error?.message ?? "missing"}`);
      return data.arrayBuffer();
    },
    rpc: async (fn, args) => {
      const { data, error } = await (own.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>)(fn, args);
      if (error) throw new Error(error.message);
      return data;
    },
  };
  // The files are read before answering: a file that cannot be read is said at once, and the page sends the rows itself.
  let read: Awaited<ReturnType<typeof readJobOnServer>>;
  try {
    read = await readJobOnServer(db, job, body.data.mappings ?? {});
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }
  after(async () => {
    try {
      const r = await stageJobOnServer(db, job, body.data.mappings ?? {}, read);
      console.info("server staging done", { job, ...r });
    } catch (e) {
      // The job stays "preparing": an open page sends the missing rows itself, otherwise the worker closes it after
      // 30 minutes and "Continue" sends what is missing.
      const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
      console.error("server staging stopped", { job, error: (e as Error).message, cause: cause?.code ?? cause?.message });
    }
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}

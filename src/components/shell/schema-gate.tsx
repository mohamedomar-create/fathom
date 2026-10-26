import "server-only";
import { getUser } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";
import { schemaBehind } from "@/lib/schema";

/**
 * The app's pages stop with one plain screen when the database is older than this app (an update not yet run), instead
 * of each feature failing in its own way.
 */
export async function SchemaGate({ children }: { children: React.ReactNode }) {
  const { supabase } = await getUser();
  const need = await schemaBehind(supabase);
  if (need === null) return <>{children}</>;
  const d = (await getDict()).state;
  console.error(JSON.stringify({ op: "schema_gate", need }));
  return (
    <div role="alert" data-testid="db-behind" className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="mb-3 text-2xl font-light">{d.dbBehindTitle}</h1>
      <p className="text-mute">{d.dbBehind(need)}</p>
    </div>
  );
}

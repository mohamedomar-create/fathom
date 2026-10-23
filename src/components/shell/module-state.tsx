"use client";
import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useT } from "@/lib/i18n/use-t";
import type { ModuleStatus } from "@/lib/company/loaded";


const when = (iso: string | null, lang: string) => iso ? new Date(iso).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;

/** Refreshes the page's server data every `every` ms while `on`, for at most `max` ms; then reports that it gave up. */
function useAutoRefresh(on: boolean, every: number, max: number) {
  const router = useRouter();
  const [gaveUp, setGaveUp] = useState(false);
  const started = useRef<number | null>(null);
  useEffect(() => {
    if (!on) { started.current = null; return; }
    started.current ??= Date.now();
    const id = setInterval(() => {
      if (Date.now() - (started.current ?? 0) > max) { setGaveUp(true); clearInterval(id); return; }
      router.refresh();
    }, every);
    return () => clearInterval(id);
  }, [on, every, max, router]);
  return on && gaveUp;
}

function RetryButton() {
  const router = useRouter();
  const t = useT().d.state;
  const [busy, start] = useTransition();
  return (
    <button type="button" disabled={busy} onClick={() => start(() => router.refresh())} data-testid="module-retry"
      className="inline-flex items-center gap-2 rounded bg-brand-d px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{busy ? t.retrying : t.retry}
    </button>
  );
}

/**
 * Shows a module's page only when it has figures to show: a failed read says so with a retry (never "upload your data"),
 * figures still being added up wait with a refresh, and figures that are not the latest carry a note with their time.
 */
export function ModuleGate({ module, state, children }: { module: "sales" | "expenses" | "payments" | "inventory"; state: ModuleStatus; children: React.ReactNode }) {
  const T = useT();
  const t = T.d.state;
  const name = t.modules[module] ?? module;
  const waiting = state.status === "pending";
  const slow = useAutoRefresh(waiting, state.hasData ? 10_000 : 5_000, 120_000);
  const at = when(state.builtAt, T.lang);
  if (state.status === "failed") {
    return (
      <div role="alert" className="mx-auto max-w-xl py-16 text-center" data-testid="module-failed" data-module={module}>
        <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-amber" strokeWidth={1.4} />
        <h2 className="text-2xl font-light">{t.failedTitle(name)}</h2>
        <p className="mt-2 text-mute">{t.failedBody}</p>
        <div className="mt-6"><RetryButton /></div>
        {state.ref && <p className="mt-4 text-xs text-mute">{t.ref(state.ref)}</p>}
      </div>
    );
  }
  if (waiting && !state.hasData) {
    return (
      <div role="status" aria-live="polite" className="mx-auto max-w-xl py-16 text-center" data-testid="module-pending" data-module={module}>
        <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin text-brand" strokeWidth={1.4} />
        <h2 className="text-2xl font-light">{t.pendingTitle(name)}</h2>
        <p className="mt-2 text-mute">{t.pendingBody}</p>
        {slow && <div className="mt-6"><p className="mb-3 text-sm">{t.pendingSlow}</p><RetryButton /></div>}
      </div>
    );
  }
  const note = state.status === "stale" ? (at ? t.stale(at) : t.staleNoTime) : waiting ? (at ? t.updating(at) : null) : null;
  return (
    <>
      {note && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded border border-amber/60 bg-amber/10 px-4 py-2 text-sm" data-testid={state.status === "stale" ? "module-stale" : "module-updating"} data-module={module}>
          <span className="flex-1">{note}{state.ref ? ` (${t.ref(state.ref)})` : ""}</span>
          {(state.status === "stale" || slow) && <RetryButton />}
        </div>
      )}
      {children}
    </>
  );
}

/**
 * A page that uses another module's figures for one check (Inventory's cost-of-sales check reads expense lines; Reports
 * include the Sales and Expenses pages): says which could not be read, with a retry, instead of hiding the whole page.
 */
export function DependencyNote({ modules }: { modules: ("sales" | "expenses" | "payments")[] }) {
  const t = useT().d.state;
  if (!modules.length) return null;
  const names = modules.map((m) => t.modules[m] ?? m).join(", ");
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded border border-amber/60 bg-amber/10 px-4 py-2 text-sm" data-testid="dependency-note">
      <span className="flex-1">{t.dependency(names)}</span>
      <RetryButton />
    </div>
  );
}

// Which modules could not be read, for pages that show another module's figures (Reports, Inventory): their "nothing
// loaded yet" boxes say "couldn't be read" instead of inviting an upload.
const UnreadContext = createContext<ReadonlySet<string>>(new Set());
export function UnreadModules({ modules, children }: { modules: string[]; children: React.ReactNode }) {
  return <UnreadContext.Provider value={new Set(modules)}>{children}</UnreadContext.Provider>;
}
export const useUnread = (module: string) => useContext(UnreadContext).has(module);

/** In place of an empty state when the module's figures could not be read. */
export function UnreadInline({ module }: { module: "sales" | "expenses" | "payments" }) {
  const t = useT().d.state;
  const name = t.modules[module] ?? module;
  return (
    <div role="alert" className="mx-auto max-w-xl py-12 text-center" data-testid="module-failed" data-module={module}>
      <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber" strokeWidth={1.4} />
      <h2 className="text-xl font-light">{t.failedTitle(name)}</h2>
      <p className="mt-2 text-mute">{t.failedBody}</p>
      <div className="mt-5"><RetryButton /></div>
    </div>
  );
}

"use client";
import { createContext, useContext, useMemo } from "react";
import { RetryButton, useAutoRefresh } from "@/components/shell/module-state";
import { EMPTY_INVENTORY, type InventoryData } from "@/lib/engine/inventory";
import { useLang } from "@/lib/i18n/context";
import { fromWire, NO_INVENTORY_STATE, type InventoryState } from "./inventory-wire";

const Ctx = createContext<{ data: InventoryData; state: InventoryState }>({ data: EMPTY_INVENTORY, state: NO_INVENTORY_STATE });

/** The summary turned back into the records the pages use (once per summary). */
export const useInventoryData = (state: InventoryState | null | undefined) => useMemo(() => (state?.wire ? fromWire(state.wire) : EMPTY_INVENTORY), [state]);

/**
 * While the database prepares a newer summary (just after an upload), the page asks again every few seconds and shows it
 * as soon as it is ready. After 3 minutes it stops asking and says so, with a Retry (O19).
 */
export function useRefreshWhilePending(pending: boolean): boolean {
  return useAutoRefresh(pending, 3000, 180_000);
}

const at = (iso: string | null | undefined, ar: boolean) => (iso ? new Date(iso).toLocaleString(ar ? "ar-EG" : "en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/** The company's stock summary for the Inventory pages (loaded once by the sector's layout). */
export function InventoryProvider({ state, children }: { state: InventoryState; children: React.ReactNode }) {
  const data = useInventoryData(state);
  const slow = useRefreshWhilePending(state.pending);
  const ar = useLang() === "ar";
  const value = useMemo(() => ({ data, state }), [data, state]);
  return (
    <Ctx.Provider value={value}>
      {state.pending && !!state.wire && (
        <p className="mb-4 flex items-center gap-2 rounded bg-band px-4 py-2 text-[13px] text-mute" role="status" data-testid="inventory-updating">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />{ar ? "جارٍ التحديث بآخر ملف رفعته… تتحدث الصفحة تلقائيًا." : "Updating with your latest upload… this page refreshes by itself."}
        </p>
      )}
      {slow && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-amber/60 bg-amber/10 px-4 py-2 text-[13px]" role="status" data-testid="inventory-slow">
          <span className="flex-1">{ar ? "تجهيز أرقام المخزون يستغرق وقتًا أطول من المعتاد. توقفت الصفحة عن التحديث التلقائي." : "Preparing your stock figures is taking longer than usual, so this page stopped checking by itself."}</span>
          <RetryButton />
        </div>
      )}
      {state.failedAt && !!state.wire && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-amber/60 bg-amber/10 px-4 py-2 text-[13px]" role="status" data-testid="inventory-stale">
          <span className="flex-1">{ar
            ? `تُعرض أرقام المخزون كما كانت في ${at(state.builtAt, ar)}: تعذّر تجهيز أحدث رفع (${at(state.failedAt, ar)}). تُعاد المحاولة كل 10 دقائق.`
            : `Showing your stock figures as they were at ${at(state.builtAt, ar)}: the latest upload couldn't be added up (${at(state.failedAt, ar)}). It's tried again every 10 minutes.`}</span>
          <RetryButton />
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

export const useInventory = () => useContext(Ctx).data;
export const useInventoryState = () => useContext(Ctx).state;

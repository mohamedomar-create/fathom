"use client";
import { createContext, useContext, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { EMPTY_INVENTORY, type InventoryData } from "@/lib/engine/inventory";
import { useLang } from "@/lib/i18n/context";
import { fromWire, NO_INVENTORY_STATE, type InventoryState } from "./inventory-wire";

const Ctx = createContext<{ data: InventoryData; state: InventoryState }>({ data: EMPTY_INVENTORY, state: NO_INVENTORY_STATE });

/** The summary turned back into the records the pages use (once per summary). */
export const useInventoryData = (state: InventoryState | null | undefined) => useMemo(() => (state?.wire ? fromWire(state.wire) : EMPTY_INVENTORY), [state]);

/**
 * While the database prepares a newer summary (just after an upload), the page asks again every few seconds and shows it
 * as soon as it is ready.
 */
export function useRefreshWhilePending(pending: boolean) {
  const router = useRouter();
  useEffect(() => {
    if (!pending) return;
    let tries = 0;
    const t = setInterval(() => { if (++tries > 60) clearInterval(t); else router.refresh(); }, 3000);
    return () => clearInterval(t);
  }, [pending, router]);
}

/** The company's stock summary for the Inventory pages (loaded once by the sector's layout). */
export function InventoryProvider({ state, children }: { state: InventoryState; children: React.ReactNode }) {
  const data = useInventoryData(state);
  useRefreshWhilePending(state.pending);
  const ar = useLang() === "ar";
  const value = useMemo(() => ({ data, state }), [data, state]);
  return (
    <Ctx.Provider value={value}>
      {state.pending && !!state.wire && (
        <p className="mb-4 flex items-center gap-2 rounded bg-band px-4 py-2 text-[13px] text-mute" role="status" data-testid="inventory-updating">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />{ar ? "جارٍ التحديث بآخر ملف رفعته… تتحدث الصفحة تلقائيًا." : "Updating with your latest upload… this page refreshes by itself."}
        </p>
      )}
      {children}
    </Ctx.Provider>
  );
}

export const useInventory = () => useContext(Ctx).data;
export const useInventoryState = () => useContext(Ctx).state;

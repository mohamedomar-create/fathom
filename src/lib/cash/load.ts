import "server-only";
import { cache } from "react";
import { getUser } from "@/lib/supabase/server";
import { loadCompanyMeta } from "@/lib/company/meta";
import { modeOf, openingCashOf, type OpeningCash } from "@/lib/company/mode";
import { timeZoneOf } from "@/lib/company/time-zone";
import { logOp, newRef } from "@/lib/observe";
import type { CashUploadRow } from "@/lib/supabase/database.types";
import type { CashField } from "./read";
import type { Entry } from "./figures";

export interface CashCompany {
  id: string; name: string; currency: string; role: "admin" | "editor" | "viewer"; readOnly: boolean; simple: boolean;
  openingCash: OpeningCash | null;
  /** Today in the business's time zone (Cairo when none is set). */
  today: string;
  /** Remembered column choices, by heading. */
  columns: Record<string, CashField | "">;
}
export type StoredEntry = Entry & { id: number; note: string; source: "file" | "app" | "copied"; upload: string | null };
export type CashUpload = Pick<CashUploadRow, "id" | "filename" | "months" | "mode" | "rows" | "skipped" | "created_at">;

function today(tz: string | null) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz ?? "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}

/** The business itself: the person must be a member (not a member → not found). Two small reads. */
export const loadCashCompany = cache(async (id: string): Promise<CashCompany> => {
  const meta = await loadCompanyMeta(id);
  const { supabase } = await getUser();
  const { data: c, error } = await supabase.from("companies").select("name, currency").eq("id", id).single();
  if (error || !c) throw error ?? new Error("company not read");
  const profile = ((meta.kpiConfig as { profile?: Record<string, unknown> } | null)?.profile ?? {}) as { cashColumns?: Record<string, CashField | ""> };
  return {
    id, name: c.name, currency: c.currency, role: meta.role, readOnly: meta.role === "viewer", simple: modeOf(meta.kpiConfig) === "simple",
    openingCash: openingCashOf(meta.kpiConfig), today: today(timeZoneOf(meta.kpiConfig)), columns: profile.cashColumns ?? {},
  };
});

/** Every entry, or why they could not be read ("update" when the database has not had migration 0037 yet). */
export const loadCashEntries = cache(async (id: string): Promise<{ ok: true; entries: StoredEntry[] } | { ok: false; reason: "update" | "failed"; ref: string }> => {
  await loadCompanyMeta(id);
  const { supabase } = await getUser();
  const t0 = Date.now();
  const { data, error } = await supabase.rpc("cash_entries_list", { p_company: id });
  if (error) {
    const ref = newRef();
    logOp({ op: "cash_entries_list", company: id, ms: Date.now() - t0, attempts: 1, outcome: "failed", code: error.code, ref });
    return { ok: false, reason: error.code === "PGRST202" ? "update" : "failed", ref };
  }
  const rows = (data ?? []) as Record<string, unknown>[];
  return {
    ok: true,
    entries: rows.map((r) => ({
      id: Number(r.id), day: String(r.day).slice(0, 10), direction: r.direction === "out" ? "out" : "in", amount: Number(r.amount) || 0,
      category: String(r.category ?? ""), party: String(r.party ?? ""), note: String(r.note ?? ""),
      paid: r.paid === true || r.paid === false ? r.paid : null, paidOn: typeof r.paidOn === "string" ? r.paidOn.slice(0, 10) : null,
      source: (r.source as StoredEntry["source"]) ?? "app", upload: (r.upload as string | null) ?? null,
    })),
  };
});

/** The finished uploads, newest first. */
export async function loadCashUploads(id: string): Promise<CashUpload[]> {
  const { supabase } = await getUser();
  const { data } = await supabase.from("cash_uploads").select("id, filename, months, mode, rows, skipped, created_at").eq("company_id", id).eq("status", "done").order("created_at", { ascending: false }).limit(50);
  return (data ?? []) as CashUpload[];
}

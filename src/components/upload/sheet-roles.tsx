"use client";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { IMPORTED, ROLE_LABEL, ROLE_ORDER, type RoleGuess, type SheetRole } from "@/lib/ingest/roles";
import { cn } from "@/lib/cn";

/**
 * Every sheet of the upload, what iReport takes it to be and why, and what it gives. The person changes any guess
 * that is wrong and confirms before going on (when a guess is unsure, a sheet with figures is left out, or a cash book
 * or bank statement is read).
 */
export function SheetRoles({ guesses, roles, onRole, gives, need, confirmed, onConfirm, bank, onBank, cashSales, onCashSales }: {
  guesses: RoleGuess[];
  roles: Record<string, SheetRole>;
  onRole: (sheet: string, role: SheetRole) => void;
  /** What each sheet gives, in a few words ("69 expense lines, 40 sales lines, 5 of your totals match"). */
  gives: Record<string, string>;
  need: boolean;
  confirmed: boolean;
  onConfirm: () => void;
  bank: Record<string, { out: boolean; in: boolean }>;
  onBank: (sheet: string, k: "out" | "in", on: boolean) => void;
  cashSales: Record<string, boolean>;
  onCashSales: (sheet: string, on: boolean) => void;
}) {
  return (
    <section className="mb-5 max-w-5xl rounded-xl border border-line" data-testid="sheet-roles">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-[16px] font-medium">Your sheets</h3>
        <span className="text-[13px] text-mute">What each sheet is. Change any that are wrong.</span>
      </div>
      <ul className="divide-y divide-line">
        {guesses.map((g, i) => {
          const role = roles[g.sheet] ?? g.role;
          const name = g.sheet.split(" › ").pop() ?? g.sheet;
          const used = IMPORTED.has(role);
          return (
            <li key={g.sheet} className="grid gap-x-4 gap-y-1 px-4 py-2.5 text-[14px] md:grid-cols-[minmax(0,14rem)_minmax(0,17rem)_minmax(0,1fr)]" data-testid="role-row">
              <div className="min-w-0 truncate font-medium" title={g.sheet}>{name}</div>
              <div>
                <select value={role} onChange={(e) => onRole(g.sheet, e.target.value as SheetRole)} className={cn("w-full rounded border px-1.5 py-1 text-[13px]", used ? "border-brand/60" : "border-line text-mute")} data-testid={`role-select-${i}`} aria-label={`What ${name} is`}>
                  {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}{r === g.role ? " (our guess)" : ""}</option>)}
                </select>
              </div>
              <div className="min-w-0 text-[13px]">
                <div className={cn(used ? "text-ink" : "text-mute")} data-testid="role-gives">{gives[g.sheet] ?? (used ? "" : "Left out on purpose.")}</div>
                <div className="text-mute">{role === g.role ? g.why : "Your choice."}{!g.sure && role === g.role ? " Please check." : ""}</div>
                {role === "bank" && (
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!bank[g.sheet]?.out} onChange={(e) => onBank(g.sheet, "out", e.target.checked)} data-testid="bank-out" /> Count money out as expenses</label>
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!bank[g.sheet]?.in} onChange={(e) => onBank(g.sheet, "in", e.target.checked)} data-testid="bank-in" /> Count money in as sales</label>
                  </div>
                )}
                {role === "cashbook" && (
                  <label className="mt-1 flex items-center gap-1.5"><input type="checkbox" checked={cashSales[g.sheet] !== false} onChange={(e) => onCashSales(g.sheet, e.target.checked)} data-testid="cash-sales" /> Count money in as sales</label>
                )}
                {g.notes.map((n) => <div key={n} className="mt-1 flex gap-1.5 text-[12px] text-[#9a6b00]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{n}</div>)}
              </div>
            </li>
          );
        })}
      </ul>
      {need && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5">
          {confirmed
            ? <span className="flex items-center gap-1.5 text-[14px] text-green-d" data-testid="roles-confirmed"><CheckCircle2 className="h-4 w-4" />Confirmed. Change a sheet above to look again.</span>
            : <><button onClick={onConfirm} className="rounded-md bg-brand-d px-4 py-1.5 text-[14px] font-medium text-white" data-testid="roles-confirm">Yes, read my sheets like this</button><span className="text-[13px] text-mute">Look at each line first.</span></>}
        </div>
      )}
    </section>
  );
}

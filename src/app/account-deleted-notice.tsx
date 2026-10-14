"use client";
import { useSearchParams } from "next/navigation";
import { useDict } from "@/lib/i18n/context";

export function AccountDeletedNotice() {
  const d = useDict().home;
  if (useSearchParams().get("account") !== "deleted") return null;
  return <div className="bg-green-bg px-6 py-3 text-center text-sm text-green-d" role="status" data-testid="account-deleted">{d.deleted}</div>;
}

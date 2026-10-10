"use client";
import { useSearchParams } from "next/navigation";

export function AccountDeletedNotice() {
  if (useSearchParams().get("account") !== "deleted") return null;
  return <div className="bg-green-bg px-6 py-3 text-center text-sm text-green-d" role="status" data-testid="account-deleted">Your account has been deleted. Thank you for trying us.</div>;
}

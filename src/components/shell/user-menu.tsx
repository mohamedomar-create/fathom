"use client";
import Link from "next/link";
import { CircleUser } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function UserMenu({ email, orgName, isAdmin }: { email: string; orgName?: string; isAdmin?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger className="rounded-full p-1 text-[#ccc] hover:bg-bar-2 hover:text-white" aria-label="Account menu" data-testid="user-menu">
        <CircleUser className="h-5 w-5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 text-sm">
        <div className="border-b border-line px-2 pb-2">
          <div className="truncate font-semibold">{email}</div>
          {orgName && <div className="truncate text-xs text-mute">{orgName}</div>}
        </div>
        <Link href="/companies" className="block rounded px-2 py-1.5 hover:bg-band">My companies</Link>
        <Link href="/dashboard" className="block rounded px-2 py-1.5 hover:bg-band">Insights Dashboard</Link>
        <Link href="/account" className="block rounded px-2 py-1.5 hover:bg-band" data-testid="menu-account">Account</Link>
        {isAdmin && <Link href="/admin/organisation" className="block rounded px-2 py-1.5 hover:bg-band">Organisation settings</Link>}
        {isAdmin && <Link href="/admin/people" className="block rounded px-2 py-1.5 hover:bg-band">User management</Link>}
        <form action="/auth/signout" method="post" className="mt-1 border-t border-line pt-1">
          <button className="w-full rounded px-2 py-1.5 text-left hover:bg-band">Logout</button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

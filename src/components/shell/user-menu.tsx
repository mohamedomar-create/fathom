"use client";
import Link from "next/link";
import { CircleUser } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDict } from "@/lib/i18n/context";
import { LangSwitch } from "./lang-switch";

export function UserMenu({ email, orgName, isAdmin }: { email: string; orgName?: string; isAdmin?: boolean }) {
  const d = useDict();
  return (
    <Popover>
      <PopoverTrigger className="rounded-full p-1 text-[#ccc] hover:bg-bar-2 hover:text-white" aria-label={d.shell.accountMenu} data-testid="user-menu">
        <CircleUser className="h-5 w-5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-60 text-sm">
        <div className="border-b border-line px-2 pb-2">
          <div className="truncate font-semibold">{email}</div>
          {orgName && <div className="truncate text-xs text-mute">{orgName}</div>}
        </div>
        <Link href="/companies" className="block rounded px-2 py-1.5 hover:bg-band">{d.shell.myCompanies}</Link>
        <Link href="/dashboard" className="block rounded px-2 py-1.5 hover:bg-band">{d.shell.insights}</Link>
        <Link href="/account" className="block rounded px-2 py-1.5 hover:bg-band" data-testid="menu-account">{d.shell.account}</Link>
        {isAdmin && <Link href="/admin/organisation" className="block rounded px-2 py-1.5 hover:bg-band">{d.shell.orgSettings}</Link>}
        {isAdmin && <Link href="/admin/people" className="block rounded px-2 py-1.5 hover:bg-band">{d.shell.people}</Link>}
        <LangSwitch className="w-full px-2 py-1.5 hover:bg-band" />
        <form action="/auth/signout" method="post" className="mt-1 border-t border-line pt-1">
          <button className="w-full rounded px-2 py-1.5 text-start hover:bg-band">{d.shell.logout}</button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

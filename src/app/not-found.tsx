import Link from "next/link";
import { getDict } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = (await getDict()).home;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="text-6xl font-light text-brand-d">404</div>
      <h1 className="mt-2 text-xl">{t.notFound}</h1>
      <p className="mt-1 text-mute">{t.notFoundText}</p>
      <div className="mt-6 flex gap-3"><Link href="/companies" className="rounded bg-brand-d px-4 py-2 text-white">{t.myCompanies}</Link><Link href="/" className="rounded border border-line px-4 py-2">{t.homeLink}</Link></div>
    </div>
  );
}

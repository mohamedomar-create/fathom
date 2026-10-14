import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";
import { getDict } from "@/lib/i18n/server";

/** Footer for public pages: operator, legal pages and support contact. */
export async function SiteFooter() {
  const d = await getDict();
  return (
    <footer className="border-t border-line py-6 text-center text-xs text-mute">
      <span>© {new Date().getFullYear()} {LEGAL.entity === APP_NAME ? APP_NAME : `${APP_NAME} · ${d.footer.operatedBy(LEGAL.entity)}`}</span>
      <nav className="mt-2 flex justify-center gap-4" aria-label={d.footer.legal}>
        <Link href="/privacy" className="hover:text-ink">{d.footer.privacy}</Link>
        <Link href="/terms" className="hover:text-ink">{d.footer.terms}</Link>
        <a href={`mailto:${LEGAL.email}`} className="hover:text-ink">{d.footer.contact}</a>
      </nav>
    </footer>
  );
}

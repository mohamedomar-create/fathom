import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { LEGAL } from "@/lib/legal";

/** Footer for public pages: operator, legal pages and support contact. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line py-6 text-center text-xs text-mute">
      <span>© {new Date().getFullYear()} {APP_NAME} · operated by {LEGAL.entity}</span>
      <nav className="mt-2 flex justify-center gap-4" aria-label="Legal">
        <Link href="/privacy" className="hover:text-ink">Privacy</Link>
        <Link href="/terms" className="hover:text-ink">Terms</Link>
        <a href={`mailto:${LEGAL.email}`} className="hover:text-ink">Contact</a>
      </nav>
    </footer>
  );
}

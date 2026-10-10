import Link from "next/link";
import { Logo } from "./logo";
import { LEGAL } from "@/lib/legal";
import { SiteFooter } from "./site-footer";

/** Layout for the privacy policy and terms: a readable column with plain headings. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white">
      <header className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-5">
        <Link href="/" className="text-lg"><Logo /></Link>
        <nav className="ml-auto flex gap-4 text-sm text-mute">
          <Link href="/privacy" className="hover:text-ink">Privacy</Link>
          <Link href="/terms" className="hover:text-ink">Terms</Link>
        </nav>
      </header>
      <main className="legal mx-auto max-w-3xl px-6 pb-16 pt-4">
        <h1 className="text-3xl font-light">{title}</h1>
        <p className="mt-1 text-sm text-mute">Effective {LEGAL.effective}</p>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

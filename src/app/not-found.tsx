import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <div className="text-6xl font-light text-brand-d">404</div>
      <h1 className="mt-2 text-xl">This page could not be found</h1>
      <p className="mt-1 text-mute">The company, report or link may have been removed, or you may not have access to it.</p>
      <div className="mt-6 flex gap-3"><Link href="/companies" className="rounded bg-brand-d px-4 py-2 text-white">My companies</Link><Link href="/" className="rounded border border-line px-4 py-2">Home</Link></div>
    </div>
  );
}

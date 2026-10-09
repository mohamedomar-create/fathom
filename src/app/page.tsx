import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-24">
      <h1 className="text-4xl font-light">{APP_NAME}</h1>
      <p className="mt-3 text-mute">{APP_TAGLINE}</p>
    </main>
  );
}

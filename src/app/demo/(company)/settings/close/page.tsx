import { getDict } from "@/lib/i18n/server";

export default async function Page() {
  const heading = (await getDict()).settingsNav.items["close"]?.[0] ?? "Month close";
  return (
    <div>
      <div className="label">6 · {heading}</div>
      <h1 className="mb-6 text-3xl font-light">{heading}</h1>
      <p className="max-w-2xl rounded-lg border border-line p-4 text-sm text-mute" data-testid="close-demo">
        In your own company, the owner or an admin closes the books month by month. A closed month&apos;s figures can&apos;t
        change: uploads and Odoo syncs leave it out, and reports for it stay as they are. Each close and reopen is recorded.
        The demo&apos;s months stay open.
      </p>
    </div>
  );
}

import { getDict } from "@/lib/i18n/server";

export default async function Page() {
  const dict = await getDict();
  const heading = dict.settingsNav.items["close"]?.[0] ?? "Month close";
  return (
    <div>
      <div className="label">6 · {heading}</div>
      <h1 className="mb-6 text-3xl font-light">{heading}</h1>
      <p className="max-w-2xl rounded-lg border border-line p-4 text-sm text-mute" data-testid="close-demo">
        {dict.setx.close.demo}
      </p>
    </div>
  );
}

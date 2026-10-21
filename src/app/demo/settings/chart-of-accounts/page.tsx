import { getDict } from "@/lib/i18n/server";
import { CoaEditor } from "@/components/settings/coa-editor";

export default async function Page() {
  const heading = (await getDict()).settingsNav.items["chart-of-accounts"]?.[0] ?? "Chart of Accounts";
  return (
    <div>
      <div className="label">2 · {heading}</div>
      <h1 className="mb-6 text-3xl font-light">{heading}</h1>
      <CoaEditor />
    </div>
  );
}

import { ModulesSettings } from "@/components/settings/modules-settings";

/** The demo company's modules: every built-in one on, read-only (an admin of a real company chooses). */
export default function Page() {
  return <ModulesSettings people={[]} />;
}

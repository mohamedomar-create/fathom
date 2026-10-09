import { CoaEditor } from "@/components/settings/coa-editor";

export default function Page() {
  return (
    <div>
      <div className="label">4 · Chart of Accounts</div>
      <h1 className="mb-6 text-3xl font-light">Chart of Accounts</h1>
      <CoaEditor />
    </div>
  );
}

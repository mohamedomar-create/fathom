import { UploadWizard } from "@/components/settings/upload-wizard";
import { getDict } from "@/lib/i18n/server";

export default async function DemoDataUpload({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { step } = await searchParams;
  const t = (await getDict()).dat.pages;
  const steps = ["opening", "financials", "tb", "sales", "expenses", "inventory", "payments"] as const;
  return (
    <div>
      <p className="mb-6 text-mute">{t.demoUploadNote}</p>
      <UploadWizard key={step ?? "any"} companyId="demo" currency="EGP" fyStart={1} savedMapping={{}} demo setupStep={steps.find((x) => x === step)} />
    </div>
  );
}

import { UploadWizard } from "@/components/settings/upload-wizard";
import { getDict } from "@/lib/i18n/server";

export default async function DemoDataUpload({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { step } = await searchParams;
  const w = (await getDict()).wiz.page;
  const steps = ["opening", "financials", "tb", "sales", "expenses", "inventory", "payments"] as const;
  return (
    <div>
      <p className="mb-6 text-mute">{w.demoIntro}</p>
      <UploadWizard key={step ?? "any"} companyId="demo" currency="EGP" fyStart={1} savedMapping={{}} demo setupStep={steps.find((x) => x === step)} />
    </div>
  );
}

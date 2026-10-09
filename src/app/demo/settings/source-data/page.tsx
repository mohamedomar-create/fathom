import { UploadWizard } from "@/components/settings/upload-wizard";

export default function DemoSourceData() {
  return (
    <div>
      <div className="label">1 · Source Data</div>
      <h1 className="mb-1 text-3xl font-light">Try the Odoo importer</h1>
      <p className="mb-6 text-mute">Drop any Odoo P&amp;L, Balance Sheet, Trial Balance or Journal Items export to see how it maps. The file is read in your browser — nothing is uploaded.</p>
      <UploadWizard companyId="demo" currency="EGP" fyStart={1} savedMapping={{}} demo />
    </div>
  );
}

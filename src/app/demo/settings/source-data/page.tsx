import { UploadWizard } from "@/components/settings/upload-wizard";

export default function DemoSourceData() {
  return (
    <div>
      <div className="label">2 · Source Data</div>
      <h1 className="mb-1 text-3xl font-light">Try adding your data</h1>
      <p className="mb-6 text-mute">Step by step. Your file stays in your browser.</p>
      <UploadWizard companyId="demo" currency="EGP" fyStart={1} savedMapping={{}} demo />
    </div>
  );
}

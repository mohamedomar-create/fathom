import { notFound } from "next/navigation";
import { ModulePage } from "@/components/modules/module-page";
import { demoModule } from "@/lib/modules/demo";

/** The demo company's page for a module added by definition, from made-up rows. */
export default async function DemoModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const d = demoModule(module);
  if (!d) notFound();
  return <ModulePage module={module} summary={d.summary} rows={d.rows} cur="EGP" base="/demo" />;
}

import { DataNav } from "@/components/data/data-nav";

export default function DataLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl py-6">
      <DataNav />
      {children}
    </div>
  );
}

"use client";
import { Suspense } from "react";
import { CompanyProvider } from "@/lib/company/context";
import type { CompanyBundle } from "@/lib/company/types";
import { TipProvider } from "@/components/ui/tooltip";
import { TopBar } from "./top-bar";
import { IconRail } from "./icon-rail";
import { NoDataGate } from "./no-data";
import { HealthBanner } from "./health-banner";

export function CompanyShell({ company, children, right, rail = true }: { company: CompanyBundle; children: React.ReactNode; right?: React.ReactNode; rail?: boolean }) {
  return (
    <CompanyProvider value={company}>
      <TipProvider>
        <Suspense>
          <TopBar right={right} />
          <div className="flex flex-col md:flex-row">
            {rail && <IconRail />}
            <main className="min-w-0 flex-1 px-4 pb-16 sm:px-8"><HealthBanner /><NoDataGate>{children}</NoDataGate></main>
          </div>
        </Suspense>
      </TipProvider>
    </CompanyProvider>
  );
}

"use client";
import { Suspense } from "react";
import { CompanyProvider } from "@/lib/company/context";
import type { CompanyBundle } from "@/lib/company/types";
import { TipProvider } from "@/components/ui/tooltip";
import { TopBar } from "./top-bar";
import { IconRail } from "./icon-rail";
import { BottomBar } from "./bottom-bar";
import { NoDataGate } from "./no-data";
import { HealthBanner } from "./health-banner";
import { setCustomModules } from "@/lib/modules/registry";
import { customDefs } from "@/lib/modules/company";

export function CompanyShell({ company, children, right, rail = true }: { company: CompanyBundle; children: React.ReactNode; right?: React.ReactNode; rail?: boolean }) {
  // The company's own modules join the browser's registry before any page reads it (the intake, the module pages).
  // Only in the browser: the server is shared between companies and passes definitions explicitly.
  if (typeof window !== "undefined") setCustomModules(customDefs(company.modules ?? []));
  return (
    <CompanyProvider value={company}>
      <TipProvider>
        <Suspense>
          <TopBar right={right} />
          <div className="flex flex-col md:flex-row">
            {rail && <IconRail />}
            <main className="min-w-0 flex-1 px-4 pb-24 sm:px-8 md:pb-16"><HealthBanner /><NoDataGate>{children}</NoDataGate></main>
          </div>
          <BottomBar />
        </Suspense>
      </TipProvider>
    </CompanyProvider>
  );
}

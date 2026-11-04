import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoPlan } from "@/components/plan/plan-pages";

export const metadata: Metadata = { title: "Business Plan" };
export default function Page() { return <Suspense><DemoPlan /></Suspense>; }

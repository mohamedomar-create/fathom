import type { Metadata } from "next";
import { demoCompany } from "@/lib/company/demo";
import { demoExpenses } from "@/lib/company/demo-expenses";
import { doctorData } from "@/lib/doctor/load";
import { DoctorView } from "@/components/doctor/doctor-view";

export const metadata: Metadata = { title: "AI System Doctor" };

export default function Page() {
  return <DoctorView data={doctorData(demoCompany(), { flags: demoExpenses().flags, decisions: [] })} />;
}

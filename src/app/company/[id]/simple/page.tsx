import type { Metadata } from "next";
import { SimpleOverview } from "@/components/simple/simple-pages";
export const metadata: Metadata = { title: "Overview" };
export default function Page() { return <SimpleOverview />; }

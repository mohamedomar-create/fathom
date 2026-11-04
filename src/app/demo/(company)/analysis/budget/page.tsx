import { redirect } from "next/navigation";

/** The budget moved to the Planning screen; old links keep working. */
export default function Page() { redirect("/demo/planning/budget"); }

import type { Metadata } from "next";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Set a new password" };

export default function ResetPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <ResetForm />
    </main>
  );
}

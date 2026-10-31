// Shown at once while a company opens (before its own layout has loaded), so a click never looks like nothing happened.
import { PageSkeleton } from "@/components/shell/page-skeleton";

export default function Loading() {
  return <PageSkeleton />;
}

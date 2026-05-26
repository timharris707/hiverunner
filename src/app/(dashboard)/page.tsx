import { redirect } from "next/navigation";
import { resolvePrimaryCompanySlug } from "@/lib/orchestration/navigation";

export default function DashboardPage() {
  redirect(`/companies/${resolvePrimaryCompanySlug()}/dashboard`);
}

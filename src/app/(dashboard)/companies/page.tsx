import { redirect } from "next/navigation";
import { resolvePrimaryCompanySlug } from "@/lib/orchestration/navigation";

export default function CompaniesPage() {
  redirect(`/companies/${resolvePrimaryCompanySlug()}`);
}

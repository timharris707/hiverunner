import { redirect } from "next/navigation";
import { resolvePrimaryCompanySlug } from "@/lib/orchestration/navigation";

export default function AgentsPage() {
  redirect(`/companies/${resolvePrimaryCompanySlug()}/team`);
}

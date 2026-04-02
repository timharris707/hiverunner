import { redirect } from "next/navigation";
import { resolvePrimaryCompanySlug } from "@/lib/orchestration/navigation";

export default function TasksPage() {
  redirect(`/companies/${resolvePrimaryCompanySlug()}/issues`);
}

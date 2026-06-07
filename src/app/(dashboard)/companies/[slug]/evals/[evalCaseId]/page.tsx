import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CompanyEvalCasePage({
  params,
}: {
  params: Promise<{ slug: string; evalCaseId: string }>;
}) {
  const { slug, evalCaseId } = await params;
  redirect(`/companies/${encodeURIComponent(slug)}/evals?evalCase=${encodeURIComponent(evalCaseId)}`);
}

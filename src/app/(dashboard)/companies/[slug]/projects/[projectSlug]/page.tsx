import { redirect } from "next/navigation";

export default async function CompanyProjectPage({
  params,
}: {
  params: Promise<{ slug: string; projectSlug: string }>;
}) {
  const { slug, projectSlug } = await params;
  redirect(`/companies/${encodeURIComponent(slug)}/projects/${encodeURIComponent(projectSlug)}/board`);
}

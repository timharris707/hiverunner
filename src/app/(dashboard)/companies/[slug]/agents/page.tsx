import { redirect } from "next/navigation";

export default async function CompanyAgentsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/companies/${encodeURIComponent(slug)}/dashboard`);
}

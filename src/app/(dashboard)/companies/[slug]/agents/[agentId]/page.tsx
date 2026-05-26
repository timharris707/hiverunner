import { redirect } from "next/navigation";

export default async function AgentDetailRedirect({
  params,
}: {
  params: Promise<{ slug: string; agentId: string }>;
}) {
  const { slug, agentId } = await params;
  redirect(`/companies/${encodeURIComponent(slug)}/agents/${encodeURIComponent(agentId)}/dashboard`);
}

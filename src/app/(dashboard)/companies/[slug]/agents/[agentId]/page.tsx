"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AgentDetailRedirect({
  params,
}: {
  params: Promise<{ slug: string; agentId: string }>;
}) {
  const { slug, agentId } = use(params);
  const router = useRouter();

  useEffect(() => {
    router.replace(`/companies/${encodeURIComponent(slug)}/agents/${encodeURIComponent(agentId)}/dashboard`);
  }, [router, slug, agentId]);

  return null;
}

import { redirect } from "next/navigation";

import PublicHomepage from "@/components/marketing/PublicHomepage";
import { resolveRootRouteBehavior } from "@/lib/root-route";

export default function HomePage() {
  const rootBehavior = resolveRootRouteBehavior();

  if (rootBehavior.kind === "redirect") {
    redirect(rootBehavior.destination);
  }

  return <PublicHomepage />;
}

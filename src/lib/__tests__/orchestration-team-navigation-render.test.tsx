import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ScopedActiveCrewPanel,
  filterBenchAgents,
  resolveScopedActiveCrew,
} from "@/components/team/ScopedActiveCrewPanel";
import { TeamRosterStateTabs } from "@/components/team/TeamRosterStateTabs";
import { listCompanyAgents } from "@/lib/orchestration/client";
import { buildCanonicalTeamPath } from "@/lib/orchestration/route-paths";
import type { OrchestrationAgent } from "@/lib/orchestration/types";

function agent(input: Partial<OrchestrationAgent> & Pick<OrchestrationAgent, "id" | "name" | "role">): OrchestrationAgent {
  return {
    slug: input.id,
    emoji: "•",
    status: "idle",
    ...input,
  };
}

async function run() {
  const html = renderToStaticMarkup(
    <TeamRosterStateTabs
      value="active"
      counts={{ active: 3, bench: 2, paused: 1, archived: 4 }}
    />,
  );

  assert.match(html, /role="tablist"/);
  assert.match(html, /Active/);
  assert.match(html, /Bench/);
  assert.match(html, /Paused/);
  assert.match(html, /Archived/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, />3</);
  assert.match(html, />2</);
  assert.match(html, />1</);
  assert.match(html, />4</);

  assert.equal(buildCanonicalTeamPath("INS"), "/INS/team");

  const roster = [
    agent({ id: "oracle", name: "Oracle", role: "Lead", rosterState: "active" }),
    agent({ id: "samantha", name: "Samantha", role: "Front End Engineer", rosterState: "active" }),
    agent({ id: "toby", name: "Toby", role: "UX Analyst", rosterState: "bench" }),
    agent({ id: "gator", name: "Gator", role: "QA Lead", rosterState: "bench" }),
    agent({ id: "paused-agent", name: "Paused", role: "Paused Agent", rosterState: "paused" }),
  ];
  const scopedCrew = resolveScopedActiveCrew({
    roster,
    activeAgentReferences: ["toby", "samantha"],
  });
  assert.deepEqual(scopedCrew.map((row) => row.name), ["Samantha", "Toby"]);
  assert.deepEqual(
    resolveScopedActiveCrew({ roster, activeAgents: roster }).map((row) => row.name),
    ["Oracle", "Samantha"],
    "Contextual Active Crew should not render Bench agents without explicit work references",
  );
  assert.deepEqual(filterBenchAgents(roster, "ux").map((row) => row.name), ["Toby"]);

  const crewHtml = renderToStaticMarkup(
    <ScopedActiveCrewPanel
      companySlug="insight"
      companyCode="INS"
      scopeLabel="Sprint 3"
      roster={roster}
      activeAgentReferences={["samantha"]}
      defaultBenchOpen
      initialBenchQuery="gator"
      onAddAgent={() => undefined}
    />,
  );
  assert.match(crewHtml, /data-testid="scoped-active-crew"/);
  assert.match(crewHtml, /Sprint 3/);
  assert.match(crewHtml, /Samantha/);
  assert.match(crewHtml, /Search Bench/);
  assert.match(crewHtml, /Gator/);
  assert.match(crewHtml, /Add Gator to this work/);
  assert.match(crewHtml, /Add/);

  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  try {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ agents: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await listCompanyAgents("insight-render-default");
    assert.match(
      requestedUrl,
      /\/api\/orchestration\/companies\/insight-render-default\/agents\?includeNonProduction=true&rosterState=active/,
      "Contextual company roster reads should request Active Crew by default",
    );

    await listCompanyAgents("insight-render-all", { rosterState: "all" });
    assert.match(
      requestedUrl,
      /\/api\/orchestration\/companies\/insight-render-all\/agents\?includeNonProduction=true&rosterState=all/,
      "Team roster reads should be able to request every roster state",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("Orchestration Team navigation render tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

import {
  closeOrchestrationDb,
  getOrchestrationDb,
  seedOrchestrationDevData,
} from "@/lib/orchestration/db";

const FORGE_PAPERCLIP_AGENT_ID = "9c9f7974-97ee-4b43-b622-ad83381c5237";
const GATER_PAPERCLIP_AGENT_ID = "e198ee19-eb6c-49f3-a89a-043fdaa3d7d1";

function main(): void {
  const db = getOrchestrationDb();
  const seeded = seedOrchestrationDevData();
  const rows = db
    .prepare(
       `SELECT a.name, a.paperclip_agent_id
       FROM agents a
       INNER JOIN projects p ON p.id = a.project_id
       WHERE p.slug = 'mission-control-orchestration' AND a.name IN ('Forge', 'Gater')
       ORDER BY a.name ASC`
    )
    .all() as Array<{ name: string; paperclip_agent_id: string | null }>;

  const mappedIds = new Map(rows.map((row) => [row.name, row.paperclip_agent_id]));
  const forgeId = mappedIds.get("Forge");
  const gaterId = mappedIds.get("Gater");

  if (forgeId !== FORGE_PAPERCLIP_AGENT_ID || gaterId !== GATER_PAPERCLIP_AGENT_ID) {
    throw new Error(
      `Seeded Paperclip IDs mismatch. Forge=${forgeId ?? "null"}, Gater=${gaterId ?? "null"}`
    );
  }

  console.log("[orchestration:seed] completed");
  console.log(`  projects: ${seeded.projectIds.length}`);
  console.log(`  agents: ${seeded.agentIds.length}`);
  console.log(`  tasks: ${seeded.taskIds.length}`);
  console.log(`  forge_paperclip_agent_id: ${forgeId}`);
  console.log(`  gater_paperclip_agent_id: ${gaterId}`);
}

try {
  main();
} finally {
  closeOrchestrationDb();
}

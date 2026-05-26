import {
  closeOrchestrationDb,
  getOrchestrationDb,
  runOrchestrationMigrations,
} from "@/lib/orchestration/db";

function main(): void {
  const db = getOrchestrationDb();
  const before = db
    .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
    .get() as { count: number };

  const result = runOrchestrationMigrations(db);

  const after = db
    .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
    .get() as { count: number };

  console.log("[orchestration:migrate] completed");
  console.log(`  applied: ${result.applied.join(", ") || "(none)"}`);
  console.log(`  skipped: ${result.skipped.join(", ") || "(none)"}`);
  console.log(`  migration_count_before: ${before.count}`);
  console.log(`  migration_count_after: ${after.count}`);
}

try {
  main();
} finally {
  closeOrchestrationDb();
}


import { expect, test } from "@playwright/test";
import { z } from "zod";

const BridgeStatusSchema = z.object({
  checkedAt: z.iso.datetime(),
  connection: z.object({
    ok: z.boolean(),
    agentId: z.string().min(1).optional(),
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        retriable: z.boolean().optional(),
      })
      .optional(),
  }),
  sync: z.object({
    lastSyncedAt: z.iso.datetime().nullable(),
    paperclipTaskCount: z.number().int().min(0),
    mappedTaskCount: z.number().int().min(0),
  }),
  mapping: z.object({
    errorCount: z.number().int().min(0),
    errors: z.array(
      z.object({
        code: z.enum([
          "missing_project_company",
          "missing_paperclip_issue_mapping",
          "missing_assignee",
          "missing_paperclip_agent_mapping",
        ]),
        taskId: z.string().uuid(),
        taskTitle: z.string().min(1),
        projectId: z.string().uuid(),
        projectName: z.string().min(1),
      })
    ),
  }),
});

test.describe("GET /api/orchestration/bridge/status", () => {
  test("returns bridge connectivity, sync metadata, and mapping diagnostics", async ({ request }) => {
    const res = await request.get("/api/orchestration/bridge/status");
    expect(res.status()).toBe(200);

    const body = BridgeStatusSchema.parse(await res.json());
    expect(body.mapping.errorCount).toBe(body.mapping.errors.length);
    expect(body.sync.mappedTaskCount).toBeLessThanOrEqual(body.sync.paperclipTaskCount);

    if (body.connection.ok) {
      expect(body.connection.agentId).toBeTruthy();
      expect(body.connection.error).toBeUndefined();
    } else {
      expect(body.connection.error).toBeTruthy();
    }
  });
});

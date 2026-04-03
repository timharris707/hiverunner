import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import fs from "fs";
import { execSync } from "child_process";

import { getOrchestrationDb } from "@/lib/orchestration/db";
import { errorResponse, handleRouteError } from "@/lib/orchestration/api";
import { updateCompanySchema } from "@/lib/orchestration/contracts";
import { archiveCompany, getCompany, updateCompany } from "@/lib/orchestration/company-service";

export const dynamic = "force-dynamic";

const PROTECTED_COMPANY_SLUGS = new Set(["neveridle-core"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    return NextResponse.json(getCompany(slug));
  } catch (error) {
    return handleRouteError(error, "company:get");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const parsed = updateCompanySchema.parse(await req.json());
    return NextResponse.json(
      updateCompany({
        companySlug: slug,
        name: parsed.name,
        slug: parsed.slug,
        description: parsed.description,
        status: parsed.status,
      })
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return errorResponse(400, "validation_error", "Invalid update company payload", error.flatten());
    }
    return handleRouteError(error, "company:patch");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    if (PROTECTED_COMPANY_SLUGS.has(slug)) {
      return errorResponse(
        403,
        "protected_company",
        "This core company is protected from deletion in Mission Control"
      );
    }

    const hard = req.nextUrl.searchParams.get("hard") === "true";

    if (hard) {
      const db = getOrchestrationDb();
      const current = db
        .prepare("SELECT id, workspace_root FROM companies WHERE slug = ?")
        .get(slug) as { id: string; workspace_root: string } | undefined;

      if (!current) {
        return errorResponse(404, "not_found", "Company not found");
      }

      // 1. Unregister agents in OpenClaw
      const agents = db.prepare("SELECT openclaw_agent_id FROM agents WHERE company_id = ?").all(current.id) as { openclaw_agent_id: string | null }[];
      for (const agent of agents) {
        if (agent.openclaw_agent_id) {
          try {
            execSync(`openclaw agents delete ${agent.openclaw_agent_id} --force`, { encoding: "utf-8", timeout: 15000 });
          } catch (e) {
            console.warn(`Failed to delete openclaw agent ${agent.openclaw_agent_id}:`, e);
          }
        }
      }

      // 2. Wipe DB records
      db.transaction(() => {
        db.prepare(`DELETE FROM tasks WHERE assignee_agent_id IN (SELECT id FROM agents WHERE company_id = ?)`).run(current.id);
        db.prepare(`DELETE FROM tasks WHERE project_id IN (SELECT id FROM projects WHERE company_id = ?)`).run(current.id);
        db.prepare(`DELETE FROM agents WHERE company_id = ?`).run(current.id);
        db.prepare(`DELETE FROM projects WHERE company_id = ?`).run(current.id);
        db.prepare(`DELETE FROM companies WHERE id = ?`).run(current.id);
      })();

      // 3. Remove filesystem workspace
      if (current.workspace_root && (current.workspace_root.includes("workspaces/") || current.workspace_root.includes("workspace-"))) {
        try {
          fs.rmSync(current.workspace_root, { recursive: true, force: true });
        } catch (e) {
          console.warn(`Failed to rm workspace_root ${current.workspace_root}:`, e);
        }
      }

      return NextResponse.json({ success: true, deleted: true, slug });
    }

    return NextResponse.json(archiveCompany(slug));
  } catch (error) {
    return handleRouteError(error, "company:delete");
  }
}

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { shouldIncludeWorkspaceInOperatorRails } from '@/lib/workspace-visibility';
import { resolveCompanyIdBySlug } from '@/lib/orchestration/company-service';
import {
  resolveCompanyWorkspaceRoot,
  resolveLegacyOpenClawAgentWorkspacePath,
} from '@/lib/workspaces/company-paths';
import { resolveOpenClawDir } from '@/lib/workspaces/root';

const OPENCLAW_DIR = resolveOpenClawDir();

interface Workspace {
  id: string;
  name: string;
  emoji: string;
  path: string;
  agentName?: string;
}

function getAgentInfo(workspacePath: string): { name: string; emoji: string } | null {
  const identityPath = path.join(workspacePath, 'IDENTITY.md');
  
  if (!fs.existsSync(identityPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(identityPath, 'utf-8');
    
    const nameMatch = content.match(/- \*\*Name:\*\* (.+)/);
    const emojiMatch = content.match(/- \*\*Emoji:\*\* (.+)/);
    
    let emoji = '📁';
    if (emojiMatch) {
      // Extract just the emoji character (first few characters before any description)
      const emojiText = emojiMatch[1].trim();
      emoji = emojiText.split(' ')[0]; // Take only the first part (the emoji)
    }
    
    return {
      name: nameMatch ? nameMatch[1].trim() : '',
      emoji,
    };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    const companySlug = req.nextUrl.searchParams.get('company');
    const workspaces: Workspace[] = [];

    if (companySlug) {
      // Alias-aware company resolution.
      const resolved = resolveCompanyIdBySlug(companySlug);
      const companyWorkspaceRoot = resolved
        ? resolveCompanyWorkspaceRoot({
            companyId: resolved.id,
            workspaceSlug: resolved.workspace_slug,
            workspaceRoot: resolved.workspace_root,
            workspaceSource: resolved.workspace_source,
          })
        : null;

      if (resolved && companyWorkspaceRoot && fs.existsSync(companyWorkspaceRoot)) {
        workspaces.push({
          id: resolved.slug,
          name: resolved.name,
          emoji: '🏢',
          path: companyWorkspaceRoot,
        });
      }

      return NextResponse.json({ workspaces });
    }
    
    // Main workspace
    const mainWorkspace = path.join(OPENCLAW_DIR, 'workspace');
    if (fs.existsSync(mainWorkspace)) {
      const mainInfo = getAgentInfo(mainWorkspace);
      workspaces.push({
        id: 'workspace',
        name: 'Main Workspace',
        emoji: mainInfo?.emoji || '⚡',
        path: mainWorkspace,
        agentName: mainInfo?.name || 'Henry',
      });
    }
    
    // Agent workspaces
    const entries = fs.readdirSync(OPENCLAW_DIR, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('workspace-')) {
        const agentId = entry.name.replace('workspace-', '');
        const workspacePath = resolveLegacyOpenClawAgentWorkspacePath(agentId).path;
        const agentInfo = getAgentInfo(workspacePath);

        if (
          !shouldIncludeWorkspaceInOperatorRails({
            workspaceId: entry.name,
            hasIdentityFile: Boolean(agentInfo),
          })
        ) {
          continue;
        }

        // Friendly workspace name: capitalize the directory id (e.g. "academic" → "Academic")
        const workspaceLabel = agentId.charAt(0).toUpperCase() + agentId.slice(1);

        workspaces.push({
          id: entry.name,
          name: workspaceLabel,
          emoji: agentInfo?.emoji || '🤖',
          path: workspacePath,
          agentName: agentInfo?.name || undefined,
        });
      }
    }
    
    // Sort: main first, then alphabetically
    workspaces.sort((a, b) => {
      if (a.id === 'workspace') return -1;
      if (b.id === 'workspace') return 1;
      return a.name.localeCompare(b.name);
    });
    
    return NextResponse.json({ workspaces });
  } catch (error) {
    console.error('Failed to list workspaces:', error);
    return NextResponse.json({ workspaces: [] }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { logActivity } from '@/lib/activities-db';
import { resolveWorkspacePathStrict } from '@/lib/files/workspace-resolver';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const workspace = (formData.get('workspace') as string) || 'workspace';
    const dirPath = (formData.get('path') as string) || '';
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    const targetDirectory = resolveWorkspacePathStrict(workspace, dirPath, { forWrite: true });
    if (!targetDirectory) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
    const { fullPath: targetDir } = targetDirectory;

    const results: Array<{ name: string; size: number; path: string }> = [];

    for (const file of files) {
      const sanitizedName = path.basename(file.name);
      const targetFile = resolveWorkspacePathStrict(
        workspace,
        path.join(dirPath, sanitizedName),
        { forWrite: true },
      );
      if (!targetFile) {
        return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 });
      }
      await fs.mkdir(targetDir, { recursive: true });

      const buffer = Buffer.from(await file.arrayBuffer());
      await fs.writeFile(targetFile.fullPath, buffer);

      results.push({
        name: sanitizedName,
        size: buffer.length,
        path: dirPath ? `${dirPath}/${sanitizedName}` : sanitizedName,
      });
    }

    logActivity('file_write', `Uploaded ${results.length} file(s) to ${workspace}/${dirPath || '/'}`, 'success', {
      metadata: { files: results.map((r) => r.name), workspace, dirPath },
    });

    return NextResponse.json({ success: true, files: results });
  } catch (error) {
    console.error('[upload] Error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}

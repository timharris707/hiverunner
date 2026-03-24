import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const { stdout, stderr } = await execAsync('openclaw gateway restart', {
      timeout: 30000,
      env: { ...process.env, PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin' },
    });

    return NextResponse.json({
      success: true,
      output: stdout + stderr,
      message: 'Gateway restart initiated',
    });
  } catch (err: unknown) {
    const error = err as { message?: string; stdout?: string; stderr?: string };
    // Exit code 0 might still throw if process ends — check output
    const output = (error.stdout || '') + (error.stderr || '');
    if (output.toLowerCase().includes('restart') || output.toLowerCase().includes('started')) {
      return NextResponse.json({ success: true, output, message: 'Gateway restart initiated' });
    }
    console.error('Gateway restart error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to restart gateway', output },
      { status: 500 }
    );
  }
}

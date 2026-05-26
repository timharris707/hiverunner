import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { resolveOpenClawDir } from "@/lib/workspaces/root";

const LEGACY_RUNTIME_DIR = resolveOpenClawDir();

export const dynamic = 'force-dynamic';

function buildProviderStatus(config: Record<string, unknown>) {
  const agents = config.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const modelConfig = defaults?.model as Record<string, unknown> | undefined;
  const modelsAliases = defaults?.models as Record<string, unknown> | undefined;
  const authProfiles = (config.auth as Record<string, unknown> | undefined)?.profiles as Record<string, unknown> | undefined;
  const env = config.env as Record<string, unknown> | undefined;

  const primaryModel = (modelConfig?.primary as string) || '';
  const fallbacks = (modelConfig?.fallbacks as string[]) || [];

  const providers = [
    {
      id: 'anthropic',
      name: 'Anthropic',
      icon: '🤖',
      authType: 'setup-token',
      models: [] as string[],
      status: 'active' as 'active' | 'inactive' | 'unconfigured',
      isPrimary: true,
      billing: 'subscription',
      note: 'Claude Pro/Max subscription',
    },
    {
      id: 'openai-codex',
      name: 'OpenAI Codex',
      icon: '🔮',
      authType: 'oauth',
      models: [] as string[],
      status: 'active' as 'active' | 'inactive' | 'unconfigured',
      isPrimary: false,
      billing: 'subscription',
      note: 'ChatGPT Plus/Pro subscription',
    },
    {
      id: 'google',
      name: 'Google Gemini',
      icon: '✨',
      authType: 'api-key',
      models: [] as string[],
      status: 'unconfigured' as 'active' | 'inactive' | 'unconfigured',
      isPrimary: false,
      billing: 'metered',
      note: 'Pay per token via Gemini API',
    },
    {
      id: 'openrouter',
      name: 'OpenRouter',
      icon: '🔄',
      authType: 'api-key',
      models: [] as string[],
      status: 'unconfigured' as 'active' | 'inactive' | 'unconfigured',
      isPrimary: false,
      billing: 'metered',
      note: 'Pay per token — fallback router',
    },
  ];

  // Populate models from model config
  if (modelsAliases) {
    for (const [modelKey] of Object.entries(modelsAliases)) {
      const providerId = modelKey.split('/')[0];
      const modelName = modelKey.split('/').slice(1).join('/');
      const p = providers.find(p => p.id === providerId);
      if (p) p.models.push(modelName);
    }
  }
  // Also add from primary/fallbacks
  for (const m of [primaryModel, ...fallbacks]) {
    if (!m) continue;
    const providerId = m.split('/')[0];
    const modelName = m.split('/').slice(1).join('/');
    const p = providers.find(p => p.id === providerId);
    if (p && !p.models.includes(modelName)) p.models.push(modelName);
  }

  // Check auth profiles
  if (authProfiles) {
    for (const [key] of Object.entries(authProfiles)) {
      const [providerId] = key.split(':');
      const p = providers.find(p => p.id === providerId);
      if (p) p.status = 'active';
    }
  }

  // Check env for Google API key
  if (env?.GEMINI_API_KEY) {
    const google = providers.find(p => p.id === 'google');
    if (google) google.status = 'active';
  }

  return providers;
}

function sanitizeLegacyRuntimeText(value: string): string {
  if (value.includes('/.openclaw') || value.includes('/openclaw/')) {
    return '***optional-runtime-path***';
  }

  return value;
}

function sanitizeConfigForDisplay(value: unknown): unknown {
  if (typeof value === 'string') {
    return sanitizeLegacyRuntimeText(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeConfigForDisplay(item));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[sanitizeLegacyRuntimeText(key)] = sanitizeConfigForDisplay(child);
    }
    return result;
  }

  return value;
}

export async function GET() {
  try {
    const configPath = `${LEGACY_RUNTIME_DIR}/openclaw.json`;
    if (!existsSync(configPath)) {
      return NextResponse.json({ error: 'Config not found' }, { status: 404 });
    }
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    // Sanitize secrets before sending to frontend
    const sanitized = JSON.parse(JSON.stringify(config));
    
    // Redact sensitive values
    if (sanitized?.channels?.telegram?.botToken) {
      sanitized.channels.telegram.botToken = '***redacted***';
    }
    if (sanitized?.gateway?.auth?.token) {
      sanitized.gateway.auth.token = '***redacted***';
    }
    if (sanitized?.env) {
      for (const key of Object.keys(sanitized.env)) {
        if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')) {
          sanitized.env[key] = '***redacted***';
        }
      }
    }
    if (sanitized?.skills?.entries) {
      for (const skill of Object.values(sanitized.skills.entries) as Record<string, unknown>[]) {
        if (skill?.apiKey) skill.apiKey = '***redacted***';
      }
    }
    if (sanitized?.plugins?.entries) {
      for (const plugin of Object.values(sanitized.plugins.entries) as Record<string, unknown>[]) {
        const cfg = plugin?.config as Record<string, unknown> | undefined;
        if (cfg?.webSearch) {
          const ws = cfg.webSearch as Record<string, unknown>;
          if (ws?.apiKey) ws.apiKey = '***redacted***';
        }
      }
    }
    if (sanitized?.auth?.profiles) {
      for (const profile of Object.values(sanitized.auth.profiles) as Record<string, unknown>[]) {
        if (profile?.token) profile.token = '***redacted***';
        if (profile?.apiKey) profile.apiKey = '***redacted***';
      }
    }
    const displayConfig = sanitizeConfigForDisplay(sanitized);

    // Build provider status from the ORIGINAL (unsanitized) config
    const providers = buildProviderStatus(config);

    return NextResponse.json({ config: displayConfig, providers });
  } catch (err) {
    console.error('Settings error:', err);
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }
}

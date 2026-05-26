# Avatar System

Agent avatars in HiveRunner. Works out of the box with zero configuration.

## How It Works

Each agent can have a custom avatar set via the **Avatar Wizard** — accessible by clicking the agent's icon/avatar in the header area of any agent profile page (`/companies/:slug/agents/:agentId`).

The wizard walks through:
1. **Source** — keep the default icon/emoji, or generate a styled avatar
2. **Identity & Style** — choose gender/presentation, optional appearance details, and a visual theme
3. **Voice** — optionally select and preview a Gemini Live voice for the agent
4. **Preview** — view 4 generated portrait options, pick one, regenerate if needed
5. **Apply** — saves the selected avatar and voice to the agent profile

## Generation Modes

### Basic icon (default, always available)

No API keys needed. Operators can choose a local icon so every agent has a recognizable avatar without external dependencies.

Good for: development, self-hosted instances, offline setups, or anywhere you want zero external dependencies.

### AI Provider (optional)

When an image generation API key is configured, the wizard generates richer AI portraits. Currently supports:

| Provider | Env Var | Notes |
|----------|---------|-------|
| OpenAI (DALL-E / gpt-image-1) | `OPENAI_API_KEY` | Recommended |

The system auto-detects whether OpenAI image generation is available at runtime. If it is not configured, users can continue with a basic icon.

### Voice Preview (optional)

The Avatar Wizard also lets users choose a real Gemini Live voice for the agent.

| Provider | Env Var | Notes |
|----------|---------|-------|
| Gemini Live | `GOOGLE_AI_API_KEY` or `GEMINI_API_KEY` | Enables voice previews and agent voice sessions |

## Setup

### Minimal (no config needed)

```bash
# Just run the app — local SVG avatars work out of the box
npm run dev
```

### With AI generation

Use the optional feature-key panel in `/companies/new`, or add keys to `.env.local`:

```bash
# Generated portraits
OPENAI_API_KEY=sk-...

# Voice previews and Gemini Live voice
GOOGLE_AI_API_KEY=...
```

Restart the dev server if you edited `.env.local` manually. Keys entered through the setup flow are stored server-side and are detected without putting secret values in the browser.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/orchestration/avatars/status` | GET | Returns current provider status (`provider`, `aiAvailable`, `setupHint`) |
| `/api/orchestration/avatars/generate-preview` | POST | Generates avatar previews. Body: `{ agentName, agentRole, styleId, gender, count }` |

## Storage

Generated avatars are stored as data URIs in the agent's `avatar_url` column. This keeps things simple and portable — no external storage dependency.

For production deployments with AI-generated images, you may want to upload to a CDN and store the URL instead. The `avatar_url` field accepts any valid URL or data URI.

## Company Theme Mode

If a company's `avatarMode` setting is `"company_theme"`, the wizard constrains style choices to maintain visual cohesion across the team. If set to `"mixed"`, all 9 styles are available.

## Files

```
src/lib/orchestration/avatar-provider.ts    — Provider detection + local SVG generation
src/components/orchestration/AvatarWizard.tsx — Wizard modal component
src/components/orchestration/avatar-theme-data.ts — Client-safe theme preset metadata
src/app/api/orchestration/avatars/status/route.ts — Provider status endpoint
src/app/api/orchestration/avatars/generate-preview/route.ts — Preview generation endpoint
```

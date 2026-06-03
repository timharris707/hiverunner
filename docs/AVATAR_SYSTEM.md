# Avatar System

Agent avatars in HiveRunner. Works out of the box with zero configuration.

## How It Works

Each agent can have a custom avatar set via the **Avatar Wizard** — accessible by clicking the agent's icon/avatar in the header area of any agent profile page (`/companies/:slug/agents/:agentId`).

The wizard walks through:
1. **Source** — keep the default icon/emoji, or generate a styled avatar
2. **Style** — pick from 9 visual themes (Cyberpunk, Pixel Art, Sci-Fi Crew, etc.)
3. **Gender** — male, female, or abstract/androgynous presentation
4. **Preview** — view 4 generated options, pick one, regenerate if needed
5. **Apply** — saves to the agent's `avatar_url` in the database

## Avatar Modes

### Basic icon (default, always available)

No API keys needed. The wizard always offers a basic Lucide icon path so agents
can launch and remain editable without any image provider configured.

Good for: development, self-hosted instances, offline setups, or anywhere you want zero external dependencies.

### AI Provider (optional)

When an image generation API key is configured, the wizard generates richer AI portraits. Currently supports:

| Provider | Env Var | Notes |
|----------|---------|-------|
| OpenAI (DALL-E / gpt-image-1) | `OPENAI_API_KEY` | Recommended |
| Replicate (Flux etc.) | `REPLICATE_API_TOKEN` | Alternative |

The system auto-detects which provider is available at runtime. If none is
configured, generated portrait controls stay unavailable and the wizard falls
back to the basic icon path with a setup hint.

## Setup

### Minimal (no config needed)

```bash
# Just run the app — basic icon avatars work out of the box
npm run dev
```

### With AI generation

Add one of these to your `.env.local`:

```bash
# Option A: OpenAI
OPENAI_API_KEY=sk-...

# Option B: Replicate
REPLICATE_API_TOKEN=r8_...
```

Restart the dev server. The wizard will auto-detect the provider.

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/orchestration/avatars/status` | GET | Returns current provider status (`provider`, `aiAvailable`, `setupHint`) |
| `/api/orchestration/avatars/generate-preview` | POST | Generates avatar previews. Body: `{ agentName, agentRole, styleId, gender, count }` |

## Storage

Generated avatars are stored as data URIs in the agent's `avatar_url` column.
Basic icon selections use icon tokens rather than generated image data. This
keeps the default path simple and portable.

For production deployments with AI-generated images, you may want to upload to a CDN and store the URL instead. The `avatar_url` field accepts any valid URL or data URI.

## Company Theme Mode

If a company's `avatarMode` setting is `"company_theme"`, the wizard constrains style choices to maintain visual cohesion across the team. If set to `"mixed"`, all 9 styles are available.

## Files

```
src/lib/orchestration/avatar-provider.ts    — Provider detection + optional AI portrait generation
src/components/orchestration/AvatarWizard.tsx — Wizard modal component
src/components/orchestration/avatar-theme-data.ts — Client-safe theme preset metadata
src/app/api/orchestration/avatars/status/route.ts — Provider status endpoint
src/app/api/orchestration/avatars/generate-preview/route.ts — Preview generation endpoint
```

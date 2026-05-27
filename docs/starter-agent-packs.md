# Starter Agent Packs

HiveRunner starter packs make a fresh workspace useful without requiring a new
operator to design every agent from scratch. During `/companies/new`, the
operator can choose a pack, review the role cards, and launch with bundled
avatars, saved voice choices, neutral role instructions, and manual-safe runtime
posture.

Starter packs do not require OpenAI, Gemini, Supabase, or hosted services. The
bundled avatars are tracked public assets. New AI-generated avatars still
require the operator's own OpenAI key, and live voice calls require the
operator's own Gemini key.

## Packs

| Pack | Default roles |
| --- | --- |
| Software/Product Studio | Builder, UX/product analyst, QA/reviewer, researcher/planner, creative/brand director |
| Solo Operator Copilot | Builder, reviewer; lead operator is available as an optional role |
| Research & Strategy Desk | Researcher, strategy synthesizer, review editor, operator briefing lead |
| Operations/Support Team | Coordinator, triage specialist, process analyst, quality reviewer |
| Content/Marketing Team | Creative director, writer/editor, researcher, copy reviewer |
| Blank/custom | No starter agents |

## Bundled Assets

Starter avatars live in `public/starter-agent-avatars/`. They were curated from
the local development instance, then reviewed as public-safe static identity
assets. They are not exported task history, memory, run logs, comments,
customer data, API keys, or private workspace context.

Each starter identity includes:

- name and role/title;
- short public-safe personality guidance;
- avatar image path;
- avatar gender/style/vibe metadata used by the Avatar Wizard;
- selected Gemini voice ID used when live voice is configured.

## Runtime Behavior

Starter agents are created with manual-safe runtime posture. Missing provider
keys do not block setup. Optional runtime/provider readiness remains visible in
the app, but a new operator can still create a workspace, inspect the team, and
start planning work with no paid provider configured.

# Advisory Board — Product Roadmap

## Vision
The Advisory Board is the killer feature of Mission Control. It turns a team of named AI agents into a real deliberative body — each with distinct expertise, personality, and perspective. No other tool does this well.

**Target users:** OpenClaw power users who want more than a single-agent chat. Founders, traders, strategists who want to "run a board meeting" with specialized AI advisors.

---

## ✅ Shipped (Day 1-2)

### Core
- [x] Session creation wizard (topic, mode, agents, rounds, pacing)
- [x] Roundtable and review modes
- [x] Rounds selector (2, 3, 5, 10, Persistent)
- [x] Manual and auto pacing
- [x] Agent selection with avatars
- [x] Persona overlay system (trading-strategist, compliance-auditor, etc.)
- [x] Per-agent rich personas (10 distinct voices)
- [x] Conversation history with speaker attribution
- [x] Agents reference each other by name
- [x] Tim (CEO) can inject directives mid-session
- [x] Devil's advocate instruction (prevents echo chambers)
- [x] Session archive and history
- [x] Export (copy, download)
- [x] Routed through OpenClaw gateway (uses Anthropic Pro subscription)
- [x] Typing indicators with agent avatars
- [x] Session search and filter
- [x] Mobile responsive
- [x] Session memory persistence (saves to data/advisory/)

---

## 🔨 Phase 1: Polish & Reliability (Next)

### P0 — Must Fix
- [ ] **Error handling**: Graceful recovery when gateway is down or API errors
- [ ] **Retry logic**: Auto-retry on 429/503 with exponential backoff
- [ ] **Loading states**: Skeleton screens while sessions load
- [ ] **Session corruption guard**: Validate JSON before write, atomic saves
- [ ] **Token/cost tracking**: Show estimated cost per session

### P1 — Quality of Life
- [ ] **Response length control in wizard**: Dropdown or slider — Concise / Balanced / Detailed / Verbose. Maps to max_tokens and prompt instructions. Default = Balanced (~2-3 paragraphs). Yesterday's 4096 was too long, 1024 was too short.
- [ ] **Review mode testing & polish**: Ensure review mode works as well as roundtable — different prompt structure, reviewer/reviewee roles clear
- [ ] **Paragraph formatting**: First-line indent on paragraphs for readability, proper spacing, clean typography
- [ ] **PDF export**: Beautiful formatted PDF with product branding, agent avatars, session metadata, clean typography. Should look like a professional advisory report.
- [ ] **Export formatting cleanup**: All exports (copy, download, PDF) should have clean formatting — no raw markdown artifacts
- [ ] **Real streaming**: SSE or WebSocket for true token-by-token streaming (currently polling)
- [ ] **Markdown rendering polish**: Code blocks, tables, lists all render cleanly
- [ ] **Copy individual messages**: Click to copy a single agent's response
- [ ] **Reaction/rating**: Thumbs up/down on individual responses (for quality tracking)
- [ ] **Session titles**: Auto-generate descriptive titles from topic + key themes
- [ ] **Keyboard shortcuts**: Enter to send directive, Cmd+N new session

---

## 🚀 Phase 2: Power Features

### Conversation Quality
- [x] **Model selection per session**: Choose Opus vs Sonnet vs GPT per session ✅
- [x] **Thinking mode toggle**: Enable extended thinking for deeper analysis ✅
- [ ] **Temperature control**: Allow tuning creativity vs precision
- [x] **Response length control**: Concise / Balanced / Detailed / Verbose ✅
- [x] **Follow-up rounds**: "Continue Discussion" button on completed sessions ✅

### Agent Management
- [x] **Custom agents**: Create new agents with custom personas from the UI ✅
- [ ] **Agent performance tracking**: Which agents give the best responses?
- [ ] **Agent memory**: Agents remember context from previous sessions
- [x] **Specialist mode**: Deep Dive 1-on-1 consultations with any agent ✅

### Session Management
- [x] **Session templates**: 6 templates (Trading, Product, Legal, Architecture, Marketing, Custom) ✅
- [ ] **Scheduled sessions**: Run a board meeting on a cron schedule
- [x] **Session branching**: Fork from any message point ✅
- [ ] **Session comparison**: Side-by-side view of two sessions on same topic

### Export & Integration
- [ ] **PDF export**: Beautifully formatted PDF report
- [ ] **Shareable links**: Public or private link to a session transcript
- [ ] **Slack/Telegram delivery**: Send session summary to a channel
- [ ] **Action item extraction**: AI identifies action items from discussion

---

## 🌟 Phase 3: Product-Grade

### Multi-User
- [ ] **Auth system**: Multiple users with roles (admin, viewer)
- [ ] **Team boards**: Shared advisory sessions across team members
- [ ] **Invite flow**: Share board access via email

### AI Quality
- [ ] **Fact grounding**: Agents can search the web during discussion
- [ ] **File context**: Upload documents for agents to reference
- [ ] **Agent tool use**: Agents can run code, query databases, check live data
- [ ] **Cross-session learning**: Board improves over time based on feedback

### Monetization
- [ ] **Tier system**: Free (3 sessions/mo) → Pro ($29/mo) → Team ($99/mo)
- [ ] **Usage metering**: Track token usage per user
- [ ] **Custom model routing**: BYOK (bring your own key) option

---

## Key Metrics to Track
- Sessions created per day/week
- Average session length (rounds)
- Agent response quality (thumbs up/down ratio)
- User retention (do they come back?)
- Most popular agent combinations
- Most popular topics/templates
- Cost per session (tokens used)

---

## Competitive Landscape
Nobody is doing this well:
- **ChatGPT/Claude**: Single agent, no multi-persona deliberation
- **AutoGen/CrewAI**: Developer-only, no UI, no personality
- **Character.ai**: Personas but no structured deliberation
- **Advisory Board = structured multi-agent deliberation with personality** — this is the gap

---

*Last updated: 2026-03-25 by Henry ⚡*

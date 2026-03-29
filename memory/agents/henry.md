# Agent Memory — Henry ⚡

**Agent ID:** `henry`
**Role:** Chief of Staff / Orchestrator
**Division:** Leadership
**Reports To:** Tim Harris (CEO)

---

## Standing Knowledge

### Orchestration Responsibilities
- Henry routes tasks, monitors agent progress, delivers morning briefs and status reports
- When no specific agent matches a task, it falls back to Henry for orchestration
- Henry assigns work via `resolveAgentForTask()` in `agent-pipeline.ts`

### Agent Roster
| ID | Name | Domain |
|---|---|---|
| `henry` | Henry ⚡ | Leadership / Orchestration |
| `t1` | Atlas 📈 | Stocks & Options Trading |
| `t2` | Nimbus 🌤️ | Weather Prediction Trading |
| `t3` | Cipher ₿ | Crypto Trading |
| `quant` | Quant 📊 | Trading Strategy Architecture |
| `backend` | Forge 🔧 | Backend / Infrastructure |
| `fullstack` | Pixel 💻 | Full-Stack / UI |
| `scout` | Scout 🔭 | Research & Intelligence |
| `quill` | Quill ✍️ | Creative / Marketing |
| `counsel` | Counsel ⚖️ | Legal & Compliance |
| `vigil` | Vigil 🛡️ | QA & Verification |

### Routing Priority
1. Explicit task `assignee` field → exact agent
2. Task tags → `TAG_AGENT_MAP` in `agent-pipeline.ts`
3. Project `owner` in `data/projects.json`
4. Henry fallback

### Data Overview
- Tasks: `data/tasks.json` — queue of pending/in-progress/done tasks
- Projects: `data/projects.json` — project metadata with owner assignments
- Build log: `data/build-log.json` — history of build executions
- Notifications: `data/notifications.json` — alerts and status updates
- Agent memory: `data/agent-memory/{agentId}.json` + `memory/agents/{name}.md`

### Mission Control App
- Next.js 14 dashboard at port 3000 (dev) or built static/server
- Key dashboard pages: `/` (overview), `/agents`, `/tasks`, `/memory`, `/office`, `/advisory`

---

## Task Log

<!-- Henry appends new entries here after completing orchestration tasks. -->

# Mission Control — Canonical Route Map

> Last updated: 2026-04-05
> Source of truth for which routes are real operator surfaces.
> Before modifying or validating any UI page, check this map first.

## How to read this

- **Top-level canonical**: Hardcoded in Dock sidebar, directly clickable
- **Canonical detail**: Reached by clicking an item on a canonical parent (agent card, task row, etc.)
- Routes use `/{code}` prefix (e.g. `/NEV/dashboard`) which middleware rewrites to `/companies/{slug}/dashboard`

---

## Top-Level Canonical (Dock Sidebar)

### OPERATIONS
| Route | Label | File |
|---|---|---|
| `/{code}/tasks` | Tasks | `companies/[slug]/tasks/page.tsx` |
| `/{code}/dashboard` | Dashboard | `companies/[slug]/dashboard/page.tsx` |
| `/{code}/inbox` | Inbox | `companies/[slug]/inbox/page.tsx` |
| `/{code}/routines` | Routines | `companies/[slug]/routines/page.tsx` |
| `/{code}/goals` | Goals | `companies/[slug]/goals/page.tsx` |

### PROJECTS (per project)
| Route | Label | File |
|---|---|---|
| `/{code}/projects/{slug}/tasks` | *Project name* | `companies/[slug]/projects/[projectSlug]/tasks/page.tsx` |

### AGENTS (per agent)
| Route | Label | File |
|---|---|---|
| `/{code}/agents/{id}` | *Agent name* | `companies/[slug]/agents/[agentId]/page.tsx` |

### COMPANY
| Route | Label | File |
|---|---|---|
| `/{code}/org` | Org | `companies/[slug]/org/page.tsx` |
| `/{code}/skills` | Skills | `companies/[slug]/skills/page.tsx` |
| `/{code}/costs` | Costs | `companies/[slug]/costs/page.tsx` |
| `/{code}/activity` | Activity | `companies/[slug]/activity/page.tsx` |
| `/{code}/files` | Files | `companies/[slug]/files/page.tsx` |
| `/{code}/settings` | Settings | `companies/[slug]/settings/page.tsx` |

### APPS
| Route | Label | File |
|---|---|---|
| `/ideas` | Ideas | `ideas/page.tsx` |
| `/advisory` | Advisory Board | `advisory/page.tsx` |
| `/marketing` | Marketing | `marketing/page.tsx` |
| `/voice` | Henry Voice | `voice/page.tsx` |
| `/trading` | Trading | `trading/page.tsx` |
| `/trading/floor` | Trading Floor | `trading/floor/page.tsx` |
| `/trading/terminal` | Trading Terminal | `trading/terminal/page.tsx` |

### SYSTEMS
| Route | Label | File |
|---|---|---|
| `/terminal` | Terminal | `terminal/page.tsx` |
| `/sessions` | Sessions | `sessions/page.tsx` |
| `/logs` | Logs | `logs/page.tsx` |

### OTHER
| Route | Label | File |
|---|---|---|
| `/settings` | Settings (TopBar) | `settings/page.tsx` |
| `/login` | Login | `login/page.tsx` |
| `/search` | Search (mobile nav) | `search/page.tsx` |

---

## Canonical Detail Routes

### Agent detail tabs (from Dock agent list or dashboard card)
| Route | Tab | File |
|---|---|---|
| `/{code}/agents/{id}/dashboard` | Dashboard | `agents/[agentId]/dashboard/page.tsx` |
| `/{code}/agents/{id}/configuration` | Configuration | `agents/[agentId]/configuration/page.tsx` |
| `/{code}/agents/{id}/budget` | Budget | `agents/[agentId]/budget/page.tsx` |
| `/{code}/agents/{id}/instructions` | Instructions | `agents/[agentId]/instructions/page.tsx` |
| `/{code}/agents/{id}/runs` | Runs | `agents/[agentId]/runs/page.tsx` |
| `/{code}/agents/{id}/skills` | Skills | `agents/[agentId]/skills/page.tsx` |

### Project detail tabs (from project tab bar)
| Route | Tab | File |
|---|---|---|
| `/{code}/projects/{slug}/tasks` | Tasks | `projects/[projectSlug]/tasks/page.tsx` |
| `/{code}/projects/{slug}/board` | Board | `projects/[projectSlug]/board/page.tsx` |
| `/{code}/projects/{slug}/overview` | Overview | `projects/[projectSlug]/overview/page.tsx` |
| `/{code}/projects/{slug}/configuration` | Configuration | `projects/[projectSlug]/configuration/page.tsx` |
| `/{code}/projects/{slug}/budget` | Budget | `projects/[projectSlug]/budget/page.tsx` |
| `/{code}/projects/{slug}/settings` | Settings | `projects/[projectSlug]/settings/page.tsx` |
| `/{code}/projects/{slug}/agents` | Agents | `projects/[projectSlug]/agents/page.tsx` |
| `/{code}/projects/{slug}/sprints` | Sprints | `projects/[projectSlug]/sprints/page.tsx` |
| `/{code}/projects/{slug}/files` | Files | `projects/[projectSlug]/files/page.tsx` |

### Entity detail (from list clicks)
| Route | From | File |
|---|---|---|
| `/{code}/tasks/{taskKey}` | Inbox items | `companies/[slug]/tasks/[taskKey]/page.tsx` |
| `/{code}/goals/{goalId}` | Goals list | `companies/[slug]/goals/[goalId]/page.tsx` |
| `/{code}/skills/{skillId}` | Skills list | `companies/[slug]/skills/[skillId]/page.tsx` |
| `/{code}/approvals/{id}` | Inbox/dashboard | `companies/[slug]/approvals/[approvalId]/page.tsx` |

### Create flows
| Route | From | File |
|---|---|---|
| `/{code}/issues/new` | Dock button, new-task button | `companies/[slug]/issues/new/page.tsx` |
| `/{code}/projects/new` | Projects page | `companies/[slug]/projects/new/page.tsx` |
| `/companies/{slug}/agents/new` | Dock agent "+" | `companies/[slug]/agents/new/page.tsx` (outside rewrite) |
| `/companies/new` | Company switcher | `companies/new/page.tsx` |

### Aliases
| Route | Alias For | Mechanism |
|---|---|---|
| `/{code}/issues` | `/{code}/tasks` | Middleware rewrite + dashboard links |
| `/{code}/team` | Agent list (mobile) | Mobile nav only |
| `/{code}/projects` | Projects list | Dock link |

# CodeGraph Evaluation - 2026-06-03

## Summary

CodeGraph is useful enough to pilot as an optional local code-navigation and
impact-analysis helper for HiveRunner agents. It should not become required for
builds, tests, CI, production runtime, or agent startup.

The strongest fit is fast orientation around known symbols: find service entry
points, inspect callers and callees, and get a first-pass impact list before an
agent edits orchestration code. The weaker areas are broad natural-language
queries, ambiguous symbol names, and test selection through `affected`, which was
less useful than `impact` in this repo.

Recommendation: pilot only. Keep usage opt-in, local, and explicitly scoped.

## What CodeGraph Does

CodeGraph builds a local `.codegraph/codegraph.db` SQLite knowledge graph for a
repo. It indexes files, symbols, imports, call edges, and full-text search data,
then exposes that through a CLI and optional MCP server.

The upstream project describes the core use case as replacing repeated
grep/read discovery with a pre-indexed local graph that agents can query for
symbol search, call graphs, context building, and impact analysis:

- GitHub: <https://github.com/colbymchenry/codegraph>
- npm package: <https://www.npmjs.com/package/@colbymchenry/codegraph>

This evaluation did not run the installer, did not run `codegraph install`, and
did not modify any global Codex, Claude, Hermes, Cursor, or MCP configuration.

## Difference From Fallow

CodeGraph and Fallow both build graph-like knowledge about the codebase, but
they answer different operational questions.

CodeGraph is navigation-oriented:

- "Where is this symbol?"
- "Who calls this function?"
- "What does this function call?"
- "What symbols/files may be affected if this changes?"
- "What context should an agent read before working in this area?"

Fallow is code-health and cleanup-oriented for JavaScript and TypeScript:

- dead code and unused exports/dependencies
- duplication
- complexity and health hotspots
- architecture boundary drift
- feature flags
- optional runtime evidence for hot/cold paths
- CI/audit style checks and autofix previews

Fallow remains better suited for cleanup, code-health gates, and deletion
confidence. CodeGraph is better suited for agent navigation before edits and
first-pass blast-radius mapping. They are complementary rather than direct
replacements.

Fallow reference used for this comparison:
<https://fallow.tools/docs/>

## Commands Tested

```sh
npx -y @colbymchenry/codegraph --help
npx -y @colbymchenry/codegraph init -i .
npx -y @colbymchenry/codegraph status .
npx -y @colbymchenry/codegraph query company --limit 8
npx -y @colbymchenry/codegraph query task --limit 8
npx -y @colbymchenry/codegraph query goal --limit 8
npx -y @colbymchenry/codegraph query provider --limit 10
npx -y @colbymchenry/codegraph query onboarding --limit 10
npx -y @colbymchenry/codegraph query getTask --limit 10
npx -y @colbymchenry/codegraph query createTask --limit 10
npx -y @colbymchenry/codegraph callers createTask --limit 12
npx -y @colbymchenry/codegraph callees createTask --limit 12
npx -y @colbymchenry/codegraph impact createTask --depth 2
npx -y @colbymchenry/codegraph affected --help
npx -y @colbymchenry/codegraph affected src/lib/orchestration/service/task.ts --depth 3
npx -y @colbymchenry/codegraph affected src/lib/orchestration/service/task.ts --depth 5 --filter "src/lib/__tests__/*.test.ts"
npx -y @colbymchenry/codegraph context "understand HiveRunner task creation flow" --max-nodes 8 --max-code 3
npx -y @colbymchenry/codegraph files --max-depth 2 --filter "src/lib/orchestration"
npx -y @colbymchenry/codegraph --version
npx -y @colbymchenry/codegraph@latest --version
npm view @colbymchenry/codegraph version dist-tags time --json
```

The attempted command below failed because `context` uses `--max-nodes`, not
`--limit`:

```sh
npx -y @colbymchenry/codegraph context "understand HiveRunner task creation flow" --limit 8
```

## HiveRunner Index Stats

`init -i .` completed locally and created only `.codegraph/` artifacts.

Observed initialization output:

- Scanned files: 987
- Indexed files reported by init: 982
- Nodes: 20,348
- Edges: 52,567
- Indexing time reported by init: 5.7s

Observed `status` output:

- Files: 987
- Nodes: 20,348
- Edges: 52,567
- Database size: 49.00 MB
- Backend: `node:sqlite`
- Journal: `wal`
- Status: index up to date

Nodes by kind:

| Kind | Count |
| --- | ---: |
| function | 5,896 |
| property | 5,293 |
| import | 4,304 |
| constant | 1,762 |
| type_alias | 1,066 |
| file | 982 |
| interface | 485 |
| variable | 462 |
| method | 84 |
| class | 7 |
| enum_member | 6 |
| enum | 1 |

Files by language:

| Language | Count |
| --- | ---: |
| TypeScript | 743 |
| TSX | 216 |
| JavaScript | 20 |
| YAML | 5 |
| Python | 3 |

The `.codegraph/` directory was 49 MB after indexing.

Version note: `npm view @colbymchenry/codegraph` reported `latest` as `0.9.9`
on 2026-06-03, but both `npx -y @colbymchenry/codegraph --version` and
`npx -y @colbymchenry/codegraph@latest --version` printed `0.9.7` locally. Pin
and record the exact version for any future pilot.

## Useful Findings

Broad concept queries worked as quick orientation, but they were noisy:

- `company` found many property definitions plus dashboard/settings pages.
- `task` found several `Task` interfaces and task payload properties.
- `goal` found goal primitives, goal service payloads, and route/page symbols.
- `provider` found runtime/cost/provider UI and service symbols.
- `onboarding` found `src/lib/onboarding/onboarding-state.ts` and related
  functions such as `readOnboardingState`.

Specific symbol queries were much more useful:

- `getTask` surfaced the service function in
  `src/lib/orchestration/service/task.ts`, the client wrapper in
  `src/lib/orchestration/client.ts`, and related task helpers.
- `createTask` surfaced the service API, client API, service index wrapper, UI
  modal, and modal input type.

`callers createTask --limit 12` identified high-value entry points:

- API route `POST` in `src/app/api/orchestration/companies/create-full/route.ts`
- `createSprintPlanningTask`
- `approveSprintPlanDraft`
- `ensureReviewTask`
- `maybeCreateGoalLeadRevisionTask`
- `maybeCreateSprintCompletedNextPlanTask`
- `InboxReader`
- `CreateTaskModal`
- multiple focused tests

`callees createTask --limit 12` gave a useful implementation checklist:

- `getOrchestrationDb`
- `resolveCompanyForTaskCreate`
- `ensureNoProjectBucket`
- `toDbStatus`
- `resolveAssigneeAgentForCompany`
- `resolveEligibleAssigneeIdsForCompany`
- `resolveCreatorAgentId`
- `nextColumnOrder`
- `generateTaskKey`
- `resolveTaskExecutionEngine`
- `normalizeTaskModelLane`

`impact createTask --depth 2` was the strongest command in the evaluation. It
reported 234 affected symbols and grouped them by file. The output connected
task creation to:

- `src/lib/orchestration/service/task.ts`
- `src/app/api/orchestration/companies/create-full/route.ts`
- goal planning and approval functions in `company-service.ts`
- goal plan and draft API routes
- `src/lib/orchestration/review-routing.ts`
- the orchestration client API
- task/inbox/dashboard UI pages
- many orchestration and voice tests

`context "understand HiveRunner task creation flow"` produced clean markdown,
but it selected UI modal types and a generic `Task` interface rather than the
central service implementation. It is useful as an orientation helper, but for
HiveRunner work agents should query known symbols first, then use normal file
reads to verify the exact implementation before editing.

`affected` was not useful in this pass. Both of these returned no test files:

```sh
npx -y @colbymchenry/codegraph affected src/lib/orchestration/service/task.ts --depth 3
npx -y @colbymchenry/codegraph affected src/lib/orchestration/service/task.ts --depth 5 --filter "src/lib/__tests__/*.test.ts"
```

That conflicts with the much richer `impact createTask` output, which did find
many relevant test symbols. For HiveRunner, `affected` should not be trusted as
the source of truth for focused test selection without more validation.

## Useful Agent Workflows

Pilot CodeGraph for these optional workflows:

1. Before editing a central orchestration symbol, run `query`, `callers`,
   `callees`, and `impact` to build a first-pass map of routes, services, UI,
   and tests.
2. During code review, run `impact <symbol>` for changed service functions to
   identify missed route/UI/test surfaces.
3. When onboarding an agent to an unfamiliar area, run broad concept searches to
   find candidate files, then narrow to exact symbols.
4. When planning parallel work, use the impact output to split ownership across
   service, API route, UI, and test surfaces.
5. Use `status` before trusting results and `sync` or `index --force` after
   significant file changes if not using the MCP watcher.

## Risks And Caveats

- `.codegraph/` is local generated state. It should remain ignored and should
  never be committed.
- Running `codegraph install` or the interactive installer can modify global
  agent configs. This evaluation intentionally avoided those paths.
- The local index is static. It can be stale unless synced or served through the
  MCP watcher.
- Broad terms are noisy because CodeGraph returns properties, interfaces, and
  same-name symbols. Agents need to disambiguate exact symbols.
- Static call and impact analysis can miss dynamic Next.js route behavior,
  runtime dispatch, wrapper indirection, and test relationships.
- `affected` did not identify obvious HiveRunner tests for
  `src/lib/orchestration/service/task.ts` during this evaluation.
- The local CLI version report did not match npm's latest metadata. Future
  pilots should pin a package version and record it in the task note.

## Recommendation

Pilot only.

Do not add CodeGraph to package scripts, CI, tests, production, or mandatory
agent startup. Do not commit its database. Do not configure global agent MCP
settings without a separate operator decision.

The highest-value pilot path is a short agent convention:

```sh
npx -y @colbymchenry/codegraph status .
npx -y @colbymchenry/codegraph query <specific-symbol> --limit 10
npx -y @colbymchenry/codegraph callers <specific-symbol> --limit 20
npx -y @colbymchenry/codegraph callees <specific-symbol> --limit 20
npx -y @colbymchenry/codegraph impact <specific-symbol> --depth 2
```

Treat those results as orientation and impact hints, then verify with direct
file reads and focused tests before editing.

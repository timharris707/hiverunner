# propose_sprint_plan engine comparison, 2026-05-16

## Summary

Both experiment branches failed to create a sprint-plan draft. Oracle produced planning prose comments and the engine import path reported `Unknown action type: propose_sprint_plan` even though the prompt included the action instructions.

The main finding is not model reluctance. The model output did include an action, but the heartbeat action dispatcher did not execute it. The fix should wire `propose_sprint_plan` into the bulk action-processing switch and add a validator that prevents lead-planning tasks from closing without a draft.

One experimental control deviated from the original procedure: the two goal names could not be byte-identical because `sprints` enforces `UNIQUE(project_id, name)`. The objective, stop condition, lead agent, project, status, and model lane were kept identical; the goal names differed only by `(hiverunner)` / `(symphony)` suffix.

## Subjects

Lead agent:

| Field | Value |
| --- | --- |
| Agent id | `74342ad5-9913-4256-9f08-bc3709c4ea1d` |
| Name | Oracle |
| Slug | `oracle-lead` |
| Role | Lead / Product Orchestrator |

Dev execution test mode was enabled for INS before the experiment.

## Goals and planning tasks

| Branch | Goal id | Goal name | Planning task id | Task key | Task engine | Task status after run |
| --- | --- | --- | --- | --- | --- | --- |
| HiveRunner | `f11b7f8a-ddec-4c8d-97d0-095c13736e0e` | `[PHASE22-EXP 20260516T071551Z] Audit memory compaction strategy (hiverunner)` | `ec4bb832-965c-42f5-9080-78e57961eae4` | INS-72 | `hiverunner` | `review` |
| Symphony | `9f36afdd-9321-4032-85f5-8b89d46dec73` | `[PHASE22-EXP 20260516T071551Z] Audit memory compaction strategy (symphony)` | `7cb0ee64-cac4-4f2d-834b-e08f564f16e3` | INS-73 | `symphony` | `done` |

Shared goal objective:

> Design a sprint plan to audit memory compaction strategy for operator trust, regression prevention, and agent context continuity. Keep the plan constrained to research, validation, and one implementation recommendation.

Shared stop condition:

> Stop after proposing one reviewable sprint plan with no execution tasks created before operator approval.

## Outcome table

| Check | HiveRunner branch | Symphony branch |
| --- | --- | --- |
| Draft row created | No | No |
| Planning task closed | No, moved to `review` | Yes, moved to `done` |
| Prose proposal comment posted | Yes | Yes |
| Action import result | `Unknown action type: propose_sprint_plan` | `Unknown action type: propose_sprint_plan` |
| Execution engine actually recorded | `hiverunner` | `hiverunner` |
| Runner provider/model | `anthropic` / `claude-sonnet-4-6` | `anthropic` / `claude-sonnet-4-6` |
| Stuck-loop warning found in logs | No | No |

The Symphony planning task stored `execution_engine = 'symphony'`, but the execution run recorded `execution_engine = 'hiverunner'`. That means this experiment did not prove a distinct Symphony runner path. It did prove that both configured branches converged into the same Anthropic/HiveRunner import path, and that path currently drops `propose_sprint_plan`.

## Execution run metadata

| Task | Run id | Status | Started | Completed | Duration | Provider | Execution engine | Runner provider | Runner model |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- |
| INS-72 | `42e9f903-ce67-4b8c-8da8-e333e9046aad` | completed | 2026-05-16T07:16:33.039Z | 2026-05-16T07:17:34.457Z | 61424ms | anthropic | hiverunner | anthropic | claude-sonnet-4-6 |
| INS-73 | `4f2d7087-b525-4bf6-acbe-2c1ff36983c5` | completed | 2026-05-16T07:17:35.781Z | 2026-05-16T07:18:50.614Z | 74836ms | anthropic | hiverunner | anthropic | claude-sonnet-4-6 |
| INS-72 | `56798f57-d9cb-40c3-854e-3468b8504e33` | completed | 2026-05-16T07:19:24.177Z | 2026-05-16T07:19:45.949Z | 21774ms | anthropic | hiverunner | anthropic | claude-sonnet-4-6 |
| INS-73 | `47d22045-da54-4d05-bd8e-64bded8fb930` | completed | 2026-05-16T07:19:24.200Z | 2026-05-16T07:20:03.095Z | 38897ms | anthropic | hiverunner | anthropic | claude-sonnet-4-6 |

Heartbeat import result excerpts:

```json
{
  "task": "INS-72",
  "messagesImported": 2,
  "actionsFound": 4,
  "actionsExecuted": 2,
  "errors": [
    "Unknown action type: propose_sprint_plan",
    "Duplicate action skipped: add_comment (add_comment:INS-72:Sprint plan proposed for opera)"
  ]
}
```

```json
{
  "task": "INS-73",
  "messagesImported": 2,
  "actionsFound": 6,
  "actionsExecuted": 3,
  "errors": [
    "Unknown action type: propose_sprint_plan",
    "Duplicate action skipped: add_comment (add_comment:INS-73:Sprint plan proposed for opera)",
    "Duplicate action skipped: update_task (update_task:INS-73:review:)"
  ]
}
```

## Raw planning comments

### INS-72 comment 1

```text
Sprint plan proposed for operator review.

**Sprint:** HiveRunner Memory Compaction Audit (2026-05-16 -> 2026-05-23)

**Shape:** Four tasks in a two-phase chain:
- Phase 1 (parallel): Scout maps compaction triggers/behavior; Toby evaluates operator trust signals - both depend on nothing
- Phase 2 (sequential): Gator identifies regression risks (depends on Scout); Oracle synthesizes into one implementation recommendation (depends on Gator + Toby)

**Bounded by:** Research and recommendation only - no implementation, no production config changes, no Symphony scope.

Awaiting operator approval before execution tasks are created.
```

### INS-73 comment 1

```text
Sprint plan proposed for operator review. The plan covers five tasks: mechanics mapping (Scout), failure scenario enumeration (Scout), continuity validation (Gator), trust scorecard (Gator), and a single implementation recommendation (Oracle). All tasks are research/validation only - no implementation work until operator approves a follow-on sprint. Awaiting review.
```

### INS-72 comment 2

```text
Sprint plan is proposed and awaiting operator approval. No execution tasks will be created until the operator approves the draft. Summary of the proposed sprint:

**Sprint:** HiveRunner Memory Compaction Audit (2026-05-16 -> 2026-05-23)

**Phase 1 (parallel):**
- Scout: Map compaction triggers, context window behavior, and summary injection points
- Toby: Evaluate operator trust signals - what visibility exists today and what is missing

**Phase 2 (sequential, after Phase 1):**
- Gator: Identify regression risks from compaction (depends on Scout)
- Oracle: Synthesize findings into one implementation recommendation (depends on Gator + Toby)

**Out of scope:** No implementation changes; research and recommendation only.

Ready for operator approval or revision.
```

## Recommendation for Commit 3

Implement the engine-agnostic fix path:

1. Add `propose_sprint_plan`, `record_validation_evidence`, and `record_success_evidence` execution cases to the bulk action-processing switch paths. The lower-level single-action executor and parser already know these action types, but the heartbeat import loop currently falls through to `Unknown action type`.
2. Add a lead-planning validator that refuses to let a sprint-planning task transition to `done` unless a `goal_sprint_plan_drafts` row exists for that planning task. On violation, keep the task open, add a system reminder comment, and log `[stuck-lead-proposal]`.
3. Keep the prose prompt instructions as a backup, but do not rely on prose alone. The evidence from this run shows the structured action was attempted and lost by dispatcher wiring.


# Orchestration Dispatch Notes

## Active hive route resolution

Task dispatch resolves the concrete runtime before any runner is called.

```
task.model_lane
      |
      v
company active execution hive
      |
      v
lane.primary + lane.fallbacks
      |
      v
execution adapter / external runner receives concrete provider + model
```

The active hive is authoritative for real task execution. Legacy task fields
such as `execution_engine` and `assigneeAdapterType` remain for older rows and
UI context, but they do not override active-hive lane routing at dispatch.

If a company has no active execution hive, dispatch fails loudly instead of
falling back to a global runtime default.

Fallback rule: dispatch tries the lane primary first, then up to three
operator-configured fallbacks. HiveRunner never auto-adds fallback providers
that are not present on the lane.

## Memory Utilization Receipts

Agents can emit a `memory_receipt` mc-action when injected memory affected a
real run. The action accepts `used`, `ignored`, and `irrelevant` arrays whose
entries may be record IDs or objects with `recordId`, `evidenceEnvelopeId`, and
`reason`.

Receipts are appended to `execution_runs.metadata_json.memoryUtilizationReceipts`
with schema `hiverunner.memory_utilization_receipts.v1`. They are agent claims,
not proof of use. Matched output/source evidence belongs in the separate
`memoryUtilizationMatchedUse` path so later scoring can compare claims against
actual output matches without overwriting `injectedMemoryEvidence`,
`injectedMemoryQuality`, or `injected_memory_sha256`.

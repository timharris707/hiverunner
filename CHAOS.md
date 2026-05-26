# HiveRunner Failure Matrix

This short matrix captures the first checks to run when a local HiveRunner lane
looks unhealthy.

| Symptom | Likely Cause | First Check |
|---|---|---|
| `http://localhost:3010` does not load | dev server stopped or wrong port | `scripts/lane.sh dev status` |
| API responds but pages are stale or broken | Next.js dev cache issue | `scripts/lane.sh dev restart` |
| tasks sit in progress with no run output | runner wakeup or assignment issue | inspect task comments and active runs |
| local login shows hosted auth | `MC_AUTH_MODE=supabase` or Supabase env is active | check `.env.local` |
| provider is missing or disabled | optional CLI/key not configured | inspect the runtime/provider page |
| fresh install shows old workspace data | reused `MC_DATA_DIR` | boot with a clean temp data directory |

Keep incident notes focused on reproducible symptoms, exact commands, and the
smallest safe recovery action.

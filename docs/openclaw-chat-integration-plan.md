# OpenClaw Chat Integration Plan

## Why this exists

We want the option to bring an OpenClaw-style chat experience into Mission Control in the near future, but **not yet**. Current priority is reliability, parity, and cleanup of the existing Mission Control product.

This document is the durable starting point so future work can begin from a clear plan instead of re-discovery.

## Current decision

- **Do not implement chat yet.**
- **Do preserve the research path now.**
- Revisit once Mission Control is stable enough that adding a major new surface will not distract from hardening.

## Legal / reuse status

OpenClaw is MIT licensed.

- Local install path checked: `/opt/homebrew/lib/node_modules/openclaw`
- Upstream repository: `https://github.com/openclaw/openclaw`
- License: MIT

This means we can legally reuse/adapt code, subject to normal MIT attribution requirements.

## Product intent

The goal is **not** to clone OpenClaw wholesale.

The goal is to bring the strongest parts of the OpenClaw web chat experience into Mission Control:
- excellent message rendering
- good composer ergonomics
- strong streaming feel
- useful handling of tool/result blocks
- clean chat session UX

But Mission Control should still remain Mission Control. We should adapt the chat surface to our own data model, runtime model, and visual system.

## Recommended approach

### Best path

**Borrow the chat UI stack in layers, not the entire app shell.**

That likely means reusing/adapting:
1. message list / transcript rendering
2. composer / input surface
3. streaming update behavior
4. attachment + tool/result block rendering
5. conversation/session chrome where useful

### What to avoid

Do **not** drag in the entire OpenClaw web app as-is.

Why:
- likely coupled to OpenClaw session/runtime contracts
- likely coupled to OpenClaw transport assumptions
- likely includes shell/state concerns irrelevant to Mission Control
- would create more integration debt than value

## First future implementation step

When we are ready to actually start, the first practical build step should be a **source audit + extraction plan**.

That work should answer:
1. Which exact OpenClaw source files implement the web chat UI?
2. Which components are reusable with minimal adaptation?
3. Which parts are tightly coupled to OpenClaw backend/session contracts?
4. What message/session data contract would Mission Control need to expose?
5. What should be copied directly vs rewritten vs wrapped?

## Proposed deliverable for that future step

Create a document like:
- `docs/openclaw-chat-component-audit.md`

And include:
- component inventory
- dependency map
- backend coupling map
- recommended extraction order
- integration risks
- MVP implementation sequence

## Working assumptions to validate later

These are not yet proven and should be validated against the upstream source:

- OpenClaw web chat is probably easier to transplant at the component/rendering layer than at the app-shell layer.
- The biggest adaptation cost will probably be the session/message transport contract, not the visual UI.
- Tool-call/result rendering will likely be one of the highest-value pieces to reuse.
- Streaming behavior and composer UX are also likely worth borrowing.

## Mission Control-specific requirements to keep in mind

When we do this for real, the integrated chat surface should:
- fit Mission Control styling and shell conventions
- work with Mission Control auth/session/runtime model
- support our agent/task/company context model cleanly
- avoid introducing a second disconnected messaging architecture
- feel native inside Mission Control, not embedded from somewhere else

## Suggested scope order when we are ready

1. Audit OpenClaw source
2. Define Mission Control chat/session contract
3. Reuse/adapt transcript renderer
4. Reuse/adapt composer
5. Add streaming updates
6. Add tool/result blocks
7. Polish shell + navigation

## Not in scope right now

Until current Mission Control stability work is in better shape, do **not** start:
- full chat implementation
- major backend chat runtime work
- broad shell refactors solely to support chat
- feature expansion that risks destabilizing current parity/hardening work

## Notes for future prompt writing

When delegating this later, explicitly tell the agent:
- this is an **audit + extraction plan first**, not a build-first task
- use the upstream OpenClaw source repo, not only the local built `dist/` output
- identify reusable source components precisely
- separate "reuse directly" from "adapt" from "rewrite"
- produce a durable doc before implementation begins

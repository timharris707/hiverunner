# Production Readiness / Human Trust Sprint

## Objective
Mission Control is **not ready for human use yet**. The core engine works, but Tim's first real hands-on pass immediately surfaced leftover test artifacts, stale setup debris, unclear company context, and too much dev-environment leakage.

This sprint is **not** about adding new features.
It is about making Mission Control feel clean, trustworthy, obvious, and ready for a human to actually use.

## Standard
Do **not** report this sprint complete until Tim can open Mission Control cold and immediately understand:
- what company he is in
- what data is real
- what is archived/test/dev noise
- where to click next
- that the system is clean and trustworthy

## Core problems to fix

### 1) Active company context is not obvious
Tim should always be able to see what company he is currently operating in.

**Required:**
- show active company prominently in the shell/header
- include company name + prefix
- make company scope obvious on pages that display company data
- if company switching exists, active selection must be explicit

### 2) Companies page is polluted with junk / archived / test companies
Tim clicked Companies and saw a bunch of unclear entries, including test/archive leftovers.

**Required:**
- hide archived companies by default
- hide test/demo/shell companies by default
- add an explicit toggle if archived/test items need to be visible
- default view should contain only meaningful, real companies

### 3) Dev/test leftovers are leaking into human-facing surfaces
We already had to manually wipe garbage from the task board. That should never have been necessary.

**Required:**
- no test/dev/smoke/chaos/debug remnants on live surfaces
- create separation between real data and test/dev data
- prevent future tests from polluting real operator views

### 4) Workflow states can remain stale after work is actually done
We saw sprint-parent status remain active after all child work was done. This breaks trust.

**Required:**
- parent tasks/goals close cleanly when child work is complete
- eliminate stale todo/in_progress/review leftovers
- no false-active status signals

### 5) First-run UX still feels like a dev environment, not a product
Tim should not need internal context to understand what he is seeing.

**Required:**
- improve empty states and guidance
- make defaults feel intentional
- clarify scope between companies / projects / tasks
- polish any visible areas that currently feel like raw developer surfaces

### 6) Ready-for-use needs a stricter definition
Do not call the product ready because the engine works.
Ready means the product is clean for human use.

**Required:**
- add or follow a production-readiness checklist
- include human-UX validation before declaring ready
- treat cleanup / trust / clarity as real acceptance criteria

## Deliverables
1. Clean UX for active company context
2. Clean Companies page default state
3. Test/archive/dev data hidden from live surfaces by default
4. Stale state cleanup / rollup behavior fixed
5. Polished first-run experience
6. Explicit checklist proving Mission Control is actually ready for use

## Reporting requirement
When reporting back:
- do not say “the sprint is done” unless you personally verified the product feels clean for human use
- include before/after screenshots or a short walkthrough summary
- explicitly call out what leftover debris was removed and how future pollution is prevented

## Tone / framing
This is a cleanup and trust sprint.
The goal is not “ship more.”
The goal is: **make the product feel reliable, intentional, and ready for Tim to use without stepping on leftovers.**

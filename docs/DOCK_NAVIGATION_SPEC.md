# Dock Navigation Specification

> **Owner:** Tim Harris  
> **Last verified:** 2026-04-03  
> **Commit:** `aeefd5f4`  
> **Source:** `src/components/TenacitOS/Dock.tsx`  
> 
> ⚠️ **DO NOT modify pixel offsets, margins, or padding in the dock without visual verification with Tim.**  
> These values were hand-tuned over multiple iterations. "Close enough" is not acceptable.

---

## Layout Constants

| Constant | Value | Notes |
|----------|-------|-------|
| `DOCK_WIDTH` | `204px` | Expanded sidebar width |
| `DOCK_COLLAPSED_WIDTH` | `44px` | Icon-only sidebar width |
| Dock padding | `6px 6px 10px` | Internal padding of the nav element |

---

## Section Hierarchy

```
NeverIdle Core (company name header)
─── Operations
    ├── Tasks          (+ button: absolute right 6px)
    ├── Dashboard      ("X live" badge)
    ├── Inbox          (count badge)
    └── Goals
─── Projects           (collapsible, + button: right 6px)
    ├── [Active Project Row]  ← accent bar, edge-to-edge
    ├── Manage
    ├── Overview
    ├── Configuration
    └── Budget
─── Agents             (collapsible, + button: right 6px)
    ├── [agent rows with status dots]
─── Company            (collapsible, + button: right 6px)
    ├── [Active Company Row]  ← accent bar, edge-to-edge
    ├── Org
    ├── Skills
    ├── Costs
    ├── Activity
    ├── Files
    └── Settings
─── Apps               (collapsible)
─── Systems            (collapsible)
```

---

## Row Types

### 1. Standard Nav Row (Operations, sub-items, Agents, Company sub-items, Systems)

```
padding: 4px 8px 4px 10px
borderRadius: 8px
border: 1px solid transparent  (inactive)
border: 1px solid rgba(255,255,255,0.18)  (active page)
background: transparent  (inactive)
background: rgba(255,255,255,0.12)  (active page)
font: 11px, fontWeight 500 (inactive) / 600 (active page)
color: #d6d3d1 (inactive) / #fafaf9 (active)
icon color: #a8a29e (inactive) / #f5f5f4 (active)
icon size: 13px, strokeWidth 2 (inactive) / 2.25 (active)
```

**No `indent: true` on any sub-items.** All sub-items use the same left padding as Operations (`10px`). This is the universal left alignment rail.

### 2. Active Context Row (Active Project, Active Company)

These represent the **currently selected working context**, not the current page.

```
accentBar: true
fontWeight: 500 (always — never bold, even when active)
background: rgba(255,255,255,0.05)
border: 1px solid rgba(255,255,255,0.08)
borderRadius: 0 (no rounding — edge-to-edge band)
boxShadow: inset 3px 0 0 0 rgba(214,211,209,0.6)  ← the accent bar
indent: true (padding: 4px 8px 4px 18px)
```

**Edge-to-edge bleed:** The accent row's **wrapper div** (not the NavRow itself) uses `margin: 0 -6px` to extend into the dock's padding area. This creates the full-width band effect. The wrapper isolates the negative margin so sibling rows are unaffected.

### 3. Section Header Row

```
fontSize: 10px
fontWeight: 700
letterSpacing: 0.16em
textTransform: uppercase
color: #a8a29e
```

`+` button in section headers:
```
width: 18px, height: 18px
borderRadius: 6px
border: 1px solid rgba(120,113,108,0.4)
background: rgba(41,37,36,0.55)
color: #d6d3d1
marginRight: 6px  ← THIS DEFINES THE COLUMN
hover: border rgba(245,158,11,0.4), bg rgba(120,53,15,0.4), color #fde68a
```

---

## The "Plus Column" — Critical Alignment Rule

The right edge of the dock has an implicit vertical column where action buttons live. **Everything in this column must be pixel-aligned.**

| Element | `right` offset | Notes |
|---------|---------------|-------|
| Section header `+` buttons | `marginRight: 6px` | Reference point — defines the column |
| Tasks row `+` button | `position: absolute; right: 6px` | Matches headers |
| Project switch button | `position: absolute; right: 11px` | Compensates for wrapper `margin: 0 -6px` |
| Company switch button | `position: absolute; right: 12px` | Compensates for wrapper `margin: 0 -6px` |
| Inbox count badge | `marginLeft: auto; marginRight: -2px` | Aligns badge right edge with column |
| "X live" badge | Inline flex, no special offset | Flows naturally |

**Why project and company offsets differ by 1px:**  
The company row's wrapper has `position: relative` for the absolutely-positioned switch button, while the project row's absolute container is inside the NavRow's own `position: relative` Link. The extra nesting level shifts the reference frame by ~1px.

---

## Accent Row vs Page Selector — Visual Differentiation

| Property | Active Page Selector | Active Context Row |
|----------|--------------------|--------------------|
| Background | `rgba(255,255,255,0.12)` (brighter) | `rgba(255,255,255,0.05)` (subtle) |
| Border | `rgba(255,255,255,0.18)` (stronger) | `rgba(255,255,255,0.08)` (softer) |
| Border radius | `8px` (pill) | `0` (full-width band) |
| Accent bar | None | `inset 3px 0 0 0 rgba(214,211,209,0.6)` |
| Font weight | `600` (bold) | `500` (non-bold) |
| Edge treatment | Normal padding | Bleeds to dock edges |

This ensures users can instantly distinguish "where I am" (page) from "what I'm working on" (context).

---

## Project Row Trailing Actions

The active project row has three inline elements in a single absolutely-positioned container:

```
Container: position absolute, right 11px, top 50%, translateY(-50%)
  ├── Pause/Play button (18x18, same style as + buttons)
  └── Switch button (18x18, same style as + buttons, only if >1 project visible)
```

**Pause button behavior:**
- Shows ⏸ (Pause icon) when project is active
- Shows ▶ (Play icon) when project is paused
- Paused state: amber color `#fbbf24`
- Calls `updateProjectSettings(id, { status })` on click

---

## Polling / Re-render Prevention

All three data sources poll every 30 seconds but **skip state updates when data hasn't changed** to prevent visual bounce:

```javascript
// Projects
setProjects((prev) => {
  if (JSON.stringify(prev) === JSON.stringify(sorted)) return prev;
  return sorted;
});

// Agents — no loading shimmer on poll, only on initial load
if (mode === "initial") setAgentsLoading(true);
setAgents((prev) => {
  if (JSON.stringify(prev) === JSON.stringify(sorted)) return prev;
  return sorted;
});

// Inbox
setInboxUnreadCount((prev) => prev === count ? prev : count);
```

---

## Hover States

All interactive rows:
```
hover background: rgba(255,255,255,0.04)
hover border: 1px solid rgba(255,255,255,0.08)
```

All 18x18 action buttons (including +, pause, switch):
```
hover border: 1px solid rgba(245,158,11,0.4)
hover background: rgba(120,53,15,0.4)
hover color: #fde68a
```

Accent rows do NOT change on hover — they maintain their subtle background.

---

## Rules for Future Changes

1. **Adding new sub-items:** Use the standard NavRow pattern with NO `indent: true`. Match Operations alignment.
2. **Adding new sections:** Follow the SectionHeader + SectionDivider pattern. `+` button gets `marginRight: 6px`.
3. **Adding new context rows:** Use `accentBar: true`, wrap in `<div style={{ margin: "0 -6px" }}>`, and tune the `right` offset on any absolute buttons until pixel-aligned with existing `+` column.
4. **Never change `right` offsets without visual verification.** The values compensate for nested positioning contexts and are not derivable from first principles alone.
5. **Never add `indent: true` to regular sub-items.** The universal left rail is `padding-left: 10px`.
6. **Test polling behavior** after any data-fetching changes. The 30s interval must not cause visual flicker.

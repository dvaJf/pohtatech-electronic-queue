# Active Ticket Home Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a user's active ticket in the home hero before Smart Route and avoid Smart Route work until no active ticket exists.

**Architecture:** Keep `ClientWorkspace` as the sole owner of ticket, position, ETA, owner scope and storage state. Extract a `HomeHero` boundary that selects skeleton, error, active-ticket, or Smart Route children. Smart Route-only workload/recommendation work mounts only in its child; global geo remains in `ClientWorkspace` because the map, nearby branch prompt and header consume it.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, Node test runner, Playwright reliability harness.

**Spec:** User-approved conversation design, 2026-09-30.

## Global Constraints

- Do not add a ticket API, store, cache or ticket state source.
- Active statuses are `SCHEDULED`, `WAITING`, `CALLED`, `SERVING`; terminal statuses are `COMPLETED`, `CANCELLED`, `NO_SHOW`.
- Home polling is 10–15 seconds, foreground/online-aware and overlap-safe; My Tickets retains its existing frequent polling.
- Do not mount Smart Route-specific work while an active ticket is rendered.
- Do not create a sticky ticket bar.

---

### Task 1: Define hero presentation contracts and tests

**Files:**
- Create: `frontend/src/features/client/home/activeTicketPresentation.ts`
- Create: `frontend/tests/active_ticket_home.test.mjs`

- [ ] Write failing literal-fixture tests for active/terminal classification, people-ahead labels, waiting/called/serving presentation and ETA formatting.
- [ ] Implement pure presentation helpers with no timer or API dependency.
- [ ] Run `node --test tests/active_ticket_home.test.mjs` and confirm green.

### Task 2: Add hero components and conditional Smart Route boundary

**Files:**
- Create: `frontend/src/features/client/home/ActiveTicketHero.tsx`
- Create: `frontend/src/features/client/home/HomeHero.tsx`
- Create: `frontend/src/features/client/home/SmartRouteHero.tsx`
- Modify: `frontend/src/features/client/ClientWorkspace.tsx`

- [ ] Add a same-slot skeleton and retry state.
- [ ] Render `ActiveTicketHero` from the existing ticket/position/ETA records; use My Tickets navigation and route offer callbacks.
- [ ] Move recommendation/workload behavior into `SmartRouteHero` so it is unmounted for an active ticket.
- [ ] Add browser assertions that active state never starts Smart Route workload requests and terminal state starts Smart Route.

### Task 3: Make Home ticket refresh lifecycle-safe

**Files:**
- Modify: `frontend/src/features/client/ClientWorkspace.tsx`
- Modify: `frontend/tests/reliability.test.mjs`

- [ ] Change Home refresh cadence to 12 seconds without changing the My Tickets 2-second cadence.
- [ ] Add one in-flight guard plus visible/online refetch listeners and cleanup.
- [ ] Verify terminal state clears the hero and stops Home refresh scheduling.

### Task 4: Verify integration

**Files:**
- Modify only files necessary to repair failures.

- [ ] Run targeted Node and browser tests at 320–430px.
- [ ] Run `npm run typecheck`, `npm test`, `npm run build`, and available reliability/browser tests.
- [ ] Inspect `git diff --check` and `git diff --stat`; do not commit or push.

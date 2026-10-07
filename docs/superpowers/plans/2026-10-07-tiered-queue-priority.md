# Tiered Queue Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace weight/quota-based automatic calling with deterministic `APPOINTMENT → QR → LIVE` tier aging and next-local-day policy activation.

**Architecture:** A pure domain function calculates `(tier, tierEnteredAt)` from ticket facts, decision time, promotion interval, and grace. PostgreSQL uses the equivalent canonical expression for atomic `CallNext`, queue position, and near-turn selection; queue-policy rows store active and next-day values separately.

**Tech Stack:** Go 1.25, PostgreSQL/pgx, SQL migrations, React 19, TypeScript 5.9, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-07-tiered-queue-priority-design.md`

## Global Constraints

- Promotion interval is exactly one of `10`, `15`, `20` minutes.
- Appointment grace is exactly one of `5`, `10`, `15` minutes.
- Automatic order is tier, tier-entry time, ticket creation time, UUID.
- Early appointment check-in permanently follows LIVE aging for that ticket.
- Policy changes become effective on the next local calendar date of the branch.
- Manual specific-ticket calling remains an explicit bypass.
- No `3:1`, `2:1`, numeric-weight, or separate hard-wait quota is introduced.

---

### Task 1: Pure tier calculation

**Files:**
- Create: `backend/internal/domain/queue_priority.go`
- Create: `backend/internal/domain/queue_priority_test.go`

**Interfaces:**
- Produces: `EffectiveQueuePriority(input QueuePriorityInput) QueuePriority`, where the result contains `Tier QueueTier` and `EnteredAt time.Time`.
- Consumes: `TicketSource`, scheduled/check-in/requeued timestamps, `DecisionAt`, `PromotionIntervalMinutes`, and `AppointmentGraceMinutes`.

- [ ] **Step 1: Write failing table tests** covering normal appointment before/at/after slot, grace boundary, appointment re-promotion, QR promotion, LIVE first/second promotion, early appointment as LIVE, and `requeued_at` cycle start.
- [ ] **Step 2: Run** `go test ./internal/domain -run 'TestEffectiveQueuePriority' -count=1` and confirm failures are caused by the missing API.
- [ ] **Step 3: Implement** the minimal pure function and named tier constants (`0` appointment, `1` QR, `2` LIVE), using half-open boundaries so promotion occurs exactly at the configured minute.
- [ ] **Step 4: Run** `go test ./internal/domain -count=1` and confirm success.

### Task 2: Next-day queue-policy persistence

**Files:**
- Create: `backend/migrations/000035_queue_priority_aging.up.sql`
- Create: `backend/migrations/000035_queue_priority_aging.down.sql`
- Modify: `backend/internal/domain/models.go`
- Modify: `backend/internal/persistence/queue_policy.go`
- Create: `backend/internal/persistence/queue_policy_aging_integration_test.go`

**Interfaces:**
- Produces: active `AntiStarvationThresholdMinutes` as promotion interval, active `AppointmentGraceMinutes`, optional scheduled values/date, and monotonic `Version`.
- Produces internal time-aware helpers `getQueuePolicyAt(ctx, tx, branchID, at)` and `updateQueuePolicyAt(ctx, command, at)`.

- [ ] **Step 1: Write failing integration tests** for exact allowed values, same-day immutability, next-local-date activation, positive/negative timezone offsets, same-day scheduled replacement, and stale-version conflict.
- [ ] **Step 2: Run** the focused integration tests against an isolated migrated database and confirm expected failures.
- [ ] **Step 3: Add migration columns** for scheduled promotion interval, scheduled grace, and effective local date, with constraints for exact allowed sets.
- [ ] **Step 4: Implement** time-aware reads/updates; preserve legacy fields for API compatibility but stop recalculating waiting tickets on save.
- [ ] **Step 5: Run** focused persistence tests and migration up/down/up verification.

### Task 3: Canonical SQL ranking and atomic call

**Files:**
- Modify: `backend/internal/persistence/queue_ranking.go`
- Modify: `backend/internal/persistence/postgres.go`
- Modify: `backend/internal/persistence/notification_outbox.go`
- Modify: `backend/internal/persistence/operator_queue.go`
- Create: `backend/internal/persistence/queue_priority_integration_test.go`
- Modify obsolete weight-order assertions in: `backend/internal/persistence/claims_regression_test.go`, `backend/internal/persistence/due_at_integration_test.go`, `backend/internal/persistence/sprint3_integration_test.go`

**Interfaces:**
- Consumes: active promotion/grace policy from Task 2.
- Produces: one canonical ranked candidate relation exposing `effective_tier` and `tier_entered_at`.

- [ ] **Step 1: Write failing integration tests** for all mixed-channel transitions, three same-slot appointments by creation time, QR promoted before a later appointment, LIVE promoted twice, tie-breaking by UUID, service filtering, and two-window concurrency.
- [ ] **Step 2: Run** focused tests and confirm the existing `due_at/source_rank` order fails them.
- [ ] **Step 3: Replace automatic selection** with the canonical tier expression and order; keep `FOR NO KEY UPDATE SKIP LOCKED` and the current window-busy guarantees.
- [ ] **Step 4: Reuse the same expression** for queue position, operator list, near-turn notifications, and decision audit fields.
- [ ] **Step 5: Replace obsolete tests** that assert configurable numeric weights or immediate policy reordering with assertions from the approved tier specification.
- [ ] **Step 6: Run** all persistence tests with `-race -count=1`.

### Task 4: Early-arrival semantics

**Files:**
- Modify: `backend/internal/persistence/sprint3.go`
- Modify: `backend/internal/domain/queue_schedule.go`
- Modify: `backend/internal/persistence/appointment_requeue_integration_test.go`
- Modify: `backend/internal/persistence/claims_regression_test.go`
- Modify: `frontend/src/features/client/ClientWorkspace.tsx`
- Create: `frontend/tests/appointment_queue_policy.test.mjs`

**Interfaces:**
- Consumes: `EffectiveQueuePriority` early-arrival rule from Task 1.
- Produces: `ArriveAppointment` accepts only a still-scheduled appointment strictly before its slot and records an irreversible early check-in.

- [ ] **Step 1: Write failing backend/frontend tests** proving the button is available only before the slot, early check-in enters immediately as LIVE, repeat is idempotent, and at/after-slot use cannot alter priority.
- [ ] **Step 2: Run** the focused tests and confirm failures.
- [ ] **Step 3: Implement** backend validation/scheduling and frontend visibility/copy without changing manual operator call behavior.
- [ ] **Step 4: Run** focused backend/frontend tests.

### Task 5: Admin API and UI

**Files:**
- Modify: `backend/internal/httpapi/admin_handlers.go`
- Modify: `backend/internal/httpapi/handlers_sprint3_test.go`
- Modify: `frontend/src/api/admin/types.ts`
- Modify: `frontend/src/api/admin/mockData.ts`
- Modify: `frontend/src/features/admin/QueuePolicyEditor.tsx`
- Create: `frontend/tests/queue_policy_editor.test.mjs`

**Interfaces:**
- Produces API fields `scheduledPromotionIntervalMinutes`, `scheduledAppointmentGraceMinutes`, and `scheduledEffectiveOn` while keeping existing active fields.
- Consumes `expectedVersion` for optimistic locking.

- [ ] **Step 1: Write failing HTTP and frontend contract tests** for allowed options, pending values, next-day notice, and version conflict.
- [ ] **Step 2: Run** focused tests and confirm failures.
- [ ] **Step 3: Implement** DTO mapping/validation and replace free-form weight controls with exact-option selectors and plain-language algorithm copy.
- [ ] **Step 4: Run** focused HTTP tests, frontend tests, and typecheck.

### Task 6: Documentation and exhaustive verification

**Files:**
- Modify: `docs/openapi.yaml`
- Modify: `docs/queue-algorithm.md`
- Modify: `README.md` only where it describes automatic ordering.

**Interfaces:**
- Documents the production interfaces and ranking implemented by Tasks 1–5.

- [ ] **Step 1: Update documentation** to remove `due_at/source_rank` as the canonical automatic order and describe the tier transitions, tie-breakers, early-arrival loss of appointment priority, and next-day settings.
- [ ] **Step 2: Run formatting/static checks:** `gofmt` on changed Go files, `go vet ./...`, frontend `npm run typecheck`, and OpenAPI parse/lint available in the repository.
- [ ] **Step 3: Run fresh complete verification:** backend `go test -race -count=1 ./...`, frontend `npm test`, frontend `npm run build`, migration up/down/up, and targeted browser smoke tests for client/admin/operator paths.
- [ ] **Step 4: Review** `git diff --check`, full diff, schema rollback, security-sensitive API behavior, and the spec requirement checklist.
- [ ] **Step 5: Commit and push** only after every required check is green, then create a merge request from `feat/queue-priority-aging` to `main` with test evidence in the description.

# Appointment Confirmation Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a server-authoritative OTP confirmation dialog and an inclusive 14-day Moscow booking window.

**Architecture:** Backend domain/persistence rules own expiration, status, resend semantics, and booking-window validation. Frontend holds only a pending-flow pointer, restores it by querying the backend, renders a Radix/InputOTP dialog outside ticket screens, and navigates only after refetching `SCHEDULED` state.

**Tech Stack:** Go, PostgreSQL, React 19, TypeScript, Radix Dialog, input-otp, Tailwind 3, Node test runner, Playwright Chromium/WebKit.

**Spec:** `docs/superpowers/specs/2026-10-04-appointment-confirmation-dialog-design.md`

## Global Constraints

- `PENDING_CONFIRMATION` never renders as an ordinary “Мои талоны” ticket.
- Backend status and `confirmationExpiresAt` are authoritative; storage retains only recovery identifiers/tokens.
- Resend keeps the original expiration and appointment ID.
- Booking dates use `Europe/Moscow`, inclusive today through today + 14 calendar days.
- Test confirm is absent and server-disabled in production.
- Use Postal tokens, Onest, Solar icons, and no copied reference theme variables.

---

### Task 1: Backend confirmation and booking rules

**Files:**
- Modify: `backend/internal/persistence/sprint2.go`
- Modify: `backend/internal/httpapi/client_handlers.go`
- Modify: `backend/internal/application/errors.go` or existing error definitions
- Test: `backend/internal/persistence/appointment_confirmation_integration_test.go`
- Test: `backend/internal/httpapi/handlers_sprint2_test.go`

**Interfaces:**
- Produces resend of the same ticket with unchanged `confirmationExpiresAt`.
- Produces creation validation for Moscow date range `[today, today+14]` and stable validation error mapping.

- [ ] Add failing integration/unit tests for resend expiry invariance and yesterday/today/+14/+15/month/year/Moscow-boundary creation.
- [ ] Run focused Go tests and confirm expected failures.
- [ ] Add a single backend booking-window policy and apply it before persistence creation; rotate resend credentials without changing expiry.
- [ ] Map out-of-window failures to a Russian 400 validation response.
- [ ] Run focused and package Go tests.

### Task 2: Frontend API contracts and UI primitives

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/src/components/ui/dialog.tsx`
- Create: `frontend/src/components/ui/input-otp.tsx`
- Create: `frontend/src/features/client/appointmentConfirmationModel.ts`
- Modify: `frontend/src/api/client/clientApi.ts`
- Modify: `frontend/src/features/client/appointmentConfirmationPolicy.ts`
- Test: `frontend/tests/appointment_confirmation_model.test.mjs`

**Interfaces:**
- Produces parsed resend `{ ok: boolean; confirmationExpiresAt: string }`.
- Produces countdown/error/status helpers with no frontend expiration fallback.
- Produces reusable accessible Dialog and six-slot OTP primitives.

- [ ] Install only `@radix-ui/react-dialog` and `input-otp` after confirming absence.
- [ ] Add failing behavior tests for resend parsing, countdown, status decisions, and production test-confirm policy.
- [ ] Run tests and confirm failures.
- [ ] Implement minimal API/model/primitives and restore production policy default false.
- [ ] Run tests and typecheck.

### Task 3: Appointment confirmation dialog and workspace state flow

**Files:**
- Create: `frontend/src/features/client/AppointmentConfirmationDialog.tsx`
- Modify: `frontend/src/features/client/ClientWorkspace.tsx`
- Delete: `frontend/src/features/client/AppointmentConfirmationCard.tsx`
- Test: `frontend/tests/appointment_confirmation_browser.test.mjs`
- Create: `frontend/tests/fixtures/appointmentConfirmationFixture.tsx`

**Interfaces:**
- Consumes backend-authoritative ticket status/expiry and Task 2 primitives.
- Produces create→dialog→server refetch→500 ms success→My Tickets flow and reload restoration.

- [ ] Add failing browser tests for no premature navigation, pending filtering, paste, errors, expiry, resend, cancel guard, focus behavior, and success navigation.
- [ ] Run the focused browser test and confirm failures.
- [ ] Implement separate pending-flow state/storage pointer and one root dialog; remove embedded cards.
- [ ] Ensure confirm success refetches server state before navigation and reload restoration opens only valid pending state.
- [ ] Run browser tests, frontend unit tests, typecheck, and build.

### Task 4: Calendar 14-day window

**Files:**
- Modify: `frontend/src/features/client/ClientWorkspace.tsx`
- Modify: `frontend/src/features/client/Appointment24hPicker.tsx`
- Create or modify: `frontend/src/features/client/calendar/bookingWindow.ts`
- Test: `frontend/tests/appointment_calendar.test.mjs`
- Test: `frontend/tests/appointment_confirmation_browser.test.mjs`

**Interfaces:**
- Consumes Moscow date policy matching backend.
- Produces disabled past/+15 dates, enabled today/+14 dates, bounded month navigation, and informational copy.

- [ ] Add failing frontend boundary and browser tests.
- [ ] Run them and confirm failures.
- [ ] Implement calendar constraints using the calendar library’s supported props and one frontend policy module.
- [ ] Run unit/browser tests at month and year boundaries.

### Task 5: One-click, flags, deployment, and E2E verification

**Files:**
- Modify: `frontend/src/pages/AppointmentConfirmPage.tsx`
- Modify: `docker-compose.yml`
- Modify: `helm/queue-chart/values.yaml`
- Modify: `helm/queue-chart/templates/backend-configmap.yaml`
- Modify: `frontend/tests/productionPass.test.mjs`
- Modify: `frontend/tests/productionPass2.test.mjs`
- Modify: `frontend/tests/restored_features.test.mjs`
- Create: `qa/appointment-confirmation-e2e.mjs`

**Interfaces:**
- Produces server-refetched one-click navigation, production-disabled bypass, and full Chromium/WebKit acceptance evidence.

- [ ] Add failing tests for one-click authoritative refetch/navigation and production flag behavior.
- [ ] Run them and confirm failures.
- [ ] Implement one-click result routing without authoritative status storage; set production defaults false.
- [ ] Run live E2E for OTP, one-click, reload, resend, wrong/expired, cancel, dev/prod flags, paste, WebKit widths, and date boundaries.
- [ ] Run full frontend test/build, focused backend tests, Helm rendering, `git diff --check`, and inspect the final diff.

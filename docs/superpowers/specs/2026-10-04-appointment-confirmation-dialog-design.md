# Appointment Confirmation Dialog Design

## Goal

Replace the embedded pending-confirmation ticket card with a temporary, accessible OTP dialog. A pending appointment is not shown in “Мои талоны”; only server-confirmed `SCHEDULED` appointments appear there. Add a Moscow-business-date booking window from today through today + 14 calendar days inclusive.

## Authoritative state

The backend owns appointment status, `confirmationExpiresAt`, and the booking window. Browser storage may retain only the pending appointment ID and management token needed to restore an interrupted flow. On create, reload, OTP confirmation, one-click confirmation, resend, and cancellation, the frontend reads the current appointment/ticket from the backend before deciding which UI to show.

`PENDING_CONFIRMATION` opens the dialog only while `confirmationExpiresAt > now`. `SCHEDULED`, `CANCELLED`, expired, or missing records never reopen it. The general active-ticket endpoint may keep returning all active workflow states for operational compatibility; the client presentation layer must exclude pending confirmation from the normal ticket list and counts.

## Confirmation flow

Creating an email appointment leaves the booking screen in place and opens `AppointmentConfirmationDialog`. The dialog uses Radix Dialog and `input-otp`, six numeric slots, `autocomplete="one-time-code"`, one primary action, resend, spam guidance, backend-derived countdown, a tertiary cancel action, and Solar icons with existing Postal tokens and Onest.

Successful confirmation must return/refetch a server `SCHEDULED` ticket. The dialog shows “Запись подтверждена” for 500 ms, clears the pending-flow pointer, refetches tickets/appointment, closes, and then opens “Мои талоны”. No reload is used.

Closing by X, Escape, or backdrop opens a compact nested decision: continue confirmation or cancel the appointment. It never navigates to “Мои талоны”. Navigation away may leave the appointment pending; backend expiry handles it.

Resend rotates the code/token for the same appointment but preserves the original `confirmationExpiresAt`. It cannot extend slot ownership. Incorrect, expired, network, already-confirmed, and cancelled states receive user-facing Russian messages without leaking server errors.

The email one-click link invokes the same domain confirmation operation as OTP. Its result page refetches authoritative server state and then routes to the workspace’s “Мои талоны” screen. An already-open workspace detects the server transition via polling.

Test confirmation remains available only when both the frontend dev/test feature policy and backend `ALLOW_TEST_APPOINTMENT_CONFIRM` guard allow it. Production defaults and deployment values are false, and the action is not rendered.

## Booking window

New appointments are allowed for Moscow calendar dates from today through today + 14 days inclusive. Yesterday and today + 15 are rejected. The backend validates creation using `Europe/Moscow` and returns a normal validation error. The calendar disables unavailable dates and month navigation; the slot-generation boundary must not produce dates outside the same window. Existing appointments are not modified.

The frontend exposes a single booking-window constant/config boundary and uses the existing calendar library’s real disabled/navigation API. Copy reads: “Запись доступна на ближайшие 14 дней.” The 14-day booking window is independent from the 15-minute confirmation lifetime.

## Components and dependencies

Add only missing packages `@radix-ui/react-dialog` and `input-otp`. Add generic primitives under `frontend/src/components/ui/` and the business dialog under `frontend/src/features/client/`. Do not copy reference CSS variables, password semantics, or add an icon library. Use the existing `cn`, Solar icons, Postal tokens, responsive safe-area patterns, and status mapper.

## Verification

Tests cover OTP success, one-click, reload pending/success, resend without expiry extension, wrong/expired code, cancel, dev and production test-confirm, OTP paste, WebKit 390/393/430 px accessibility/overflow, and the today/+14/+15/yesterday/month/year/timezone booking boundaries. Production build and relevant Go suites must pass.

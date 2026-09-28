# Mobile Geo, Nearby and Production Hardening Design

## Goal

Restore the primary mobile journey so one authoritative location stream drives recommendation, nearby detection, and the map marker, while the map never overrides deliberate user navigation. Harden the existing deployment and authentication path without replacing the application architecture.

## Scope and boundaries

- Keep `ClientWorkspace`, React 19, the existing API client, Go backend, Docker Compose, and Nginx.
- Do not add a state framework, mapping library, frontend framework, or a new branch catalogue service.
- Preserve the current home structure and Russian Post blue visual language.
- Preserve unrelated dirty-worktree changes.

## Geo and nearby lifecycle

`useGeofencing` owns browser coordinates and permission state. An explicit Geo request obtains an immediate position and starts at most one `watchPosition`; an already-granted permission may restore tracking without opening a new permission prompt. The watcher is cleared on unmount, permission failure, or simulation-mode change.

The same coordinates feed recommendation, proximity, and the map user marker. Background updates never request map centering. An explicit Geo action carries a separate one-shot center intent.

Nearby uses Haversine distance, a 75 m entry threshold, and the existing 120 m exit hysteresis. Dismissal is keyed by branch ID for the current visit. Remaining inside does not reopen the card; exiting beyond 120 m clears that visit, and entering another branch is independent. The first valid fix can open the card immediately.

Automatic nearby UI is a compact card with branch name, distance/travel estimate, “Взять талон”, “Подробнее”, and close. It does not select a map branch, open the large ArrivalSheet, or move the viewport.

## Recommendation and actions

Personal recommendation renders only from a valid real GPS fix. Without it, the home shows a neutral geolocation prompt.

A shared calculation helper validates finite, non-negative travel and queue durations in minutes and returns `travelTimeMinutes`, `queueWaitingMinutes`, `totalTimeMinutes`, and a positive `savingMinutes` only when nearest and fastest differ. No clamp may hide a unit or timestamp error.

Recommendation actions are “Взять талон”, “Маршрут”, and “Записаться ко времени”. “Выбрать” is removed. Appointment is shown only when the branch has confirmed enabled services and the existing appointment endpoint can serve it; no speculative catalogue flag is introduced.

## Map lifecycle and accessibility

Each map opening applies the requested filter/target afresh and invalidates pending focus work. Target focus uses branch ID, measured overlay margins, and a generation token so stale async pan/zoom operations cannot win. Closing invalidates work and restores focus to the opener.

Automatic GPS updates only move the marker. First GPS center and explicit Geo center are allowed; pan/zoom marks the viewport as user-controlled. Detail overlay resizing may keep the selected marker visible only for the active focus generation.

The dialog supports Escape, initial focus, Tab containment, focus return, body scroll restoration, correct ARIA, visible `:focus-visible`, and 44 px critical touch targets.

## Text scaling

The application no longer changes `html` font size. A scoped `data-text-scale`/CSS-variable system scales client-facing typography at 100%, 125%, and 150%. Layout dimensions, icons, map controls, marker typography, marker padding, and hit areas retain intentional fixed geometry.

## Backend and deployment

Yandex OAuth issues a cryptographically random, short-lived HttpOnly/Secure/SameSite=Lax state cookie and rejects callbacks whose state is missing or mismatched. Demo login is allowed only in development/test and fails closed in production.

`/health` remains process liveness. `/ready` requires database connectivity and the schema version needed by runtime queries. Startup/deployment does not report success when mandatory migrations fail. Compose dependencies use readiness.

Production frontend is a built static Vite bundle served by an Nginx frontend container; `/api` remains routed by the host Nginx to the Go backend. Tracked Nginx configuration includes the required OAuth route and forwarded headers. Production deployment is not performed without an explicit deploy action.

## Catalogue honesty

The audit records exactly 26 API records: 25 seeded demo catalogue records plus one legacy demo record. Static catalogue records remain `DEMO_ONLY`; unverified ratings and photos are not attributed to Yandex Maps. The audit report records ID, name, address, coordinates, status, and provenance without inventing verification.

## Verification

Add lifecycle regression coverage for watcher uniqueness/cleanup, immediate and walking entry, branch-scoped dismissal and hysteresis, map pan/explicit center/focus cancellation/reopen, recommendation validity, dialog keyboard behavior, text scaling at 320/360/390/430 px and desktop, OAuth state/demo restrictions, readiness/schema behavior, production image/config, and catalogue count/provenance. Run frontend tests, typecheck, build, browser smoke checks, backend tests/build, Docker/Nginx validation, and read-only production checks where safe.

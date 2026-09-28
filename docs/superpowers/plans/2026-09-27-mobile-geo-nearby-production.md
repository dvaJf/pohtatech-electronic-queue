# Mobile Geo, Nearby and Production Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mobile branch journey location-correct, non-intrusive, accessible, secure, and production-ready.

**Architecture:** Keep `ClientWorkspace` as the flow coordinator while extracting pure geo/recommendation policies and making `useGeofencing` the sole coordinate owner. Preserve Yandex Maps integration but separate marker updates from explicit viewport intent. Harden the current Go/Compose/Nginx deployment in place.

**Tech Stack:** React 19, TypeScript, Vite, Yandex Maps 2.1, Node test runner, Go, PostgreSQL, Docker Compose, Nginx.

**Spec:** `docs/superpowers/specs/2026-09-27-mobile-geo-nearby-production-design.md`

## Global Constraints

- Preserve existing dirty-worktree changes and do not rewrite `ClientWorkspace` wholesale.
- One active geolocation watcher maximum; all location consumers use the same coordinates.
- Background GPS never recenters a user-controlled map.
- Nearby entry is 75 m; exit hysteresis is 120 m.
- Do not change root `html` font size for accessibility scaling.
- No new state framework, mapping library, frontend framework, or speculative branch API contract.
- Never print secret values.

---

### Task 1: Authoritative geolocation and nearby visit policy

**Files:**
- Modify: `frontend/src/features/client/arrival/useGeofencing.ts`
- Modify: `frontend/src/features/client/arrival/arrivalPolicy.ts`
- Modify: `frontend/src/features/client/map/geolocation.ts`
- Modify: `frontend/src/features/client/ClientWorkspace.tsx`
- Test: `frontend/tests/geofencing_arrival.test.mjs`
- Test: `frontend/tests/geolocation_retry.test.mjs`
- Test: `frontend/tests/branch_map.test.mjs`

**Interfaces:**
- Produces: shared coordinates, `requestGpsPermission({ centerMap?: boolean })`, watcher cleanup, and branch-keyed visit decisions.
- Consumes: Haversine distance and existing 75/120 m thresholds.

- [ ] Replace the source-regex assertion that bans `watchPosition` with failing tests for one watcher, cleanup, initial-inside entry, outside-to-inside entry, A dismissal/re-entry, and A-to-B independence.
- [ ] Run the three focused test files and confirm the new lifecycle assertions fail.
- [ ] Implement one watcher owned by `useGeofencing`, with immediate explicit lookup and cleanup on every lifecycle exit.
- [ ] Add a pure branch-visit policy keyed by branch ID; remove mode-wide dismissal and large automatic ArrivalSheet invocation.
- [ ] Add the compact nearby card and route its actions through existing branch-ID ticket/map flows.
- [ ] Run the focused tests and typecheck.

### Task 2: Map viewport intent, focus cancellation, and dialog accessibility

**Files:**
- Modify: `frontend/src/features/client/map/BranchMapModal.tsx`
- Modify: `frontend/src/features/client/map/mapViewportPolicy.ts`
- Modify: `frontend/src/features/client/ClientWorkspace.tsx`
- Create: `frontend/src/hooks/useModalFocus.ts`
- Test: `frontend/tests/map_viewport.test.mjs`
- Test: `frontend/tests/branch_map.test.mjs`
- Test: `frontend/tests/header_accessibility.test.mjs`

**Interfaces:**
- Consumes: parent geo coordinates and explicit center request sequence from Task 1.
- Produces: generation-guarded `focusBranchOnMap(branchId)`, fresh open state, accessible dialog lifecycle.

- [ ] Add failing tests for manual pan stability, one-shot Geo centering, reopen state, requested filters, focus cancellation, Escape, focus containment, and focus return.
- [ ] Run focused tests and confirm failure.
- [ ] Remove map-owned geolocation lookup; synchronize marker from the shared coordinates.
- [ ] Reset/apply open parameters per opening and invalidate pending pan/zoom work on new focus, pan, close, or reopen.
- [ ] Retain measured overlay margins and prevent resize callbacks from resurrecting stale focus.
- [ ] Add reusable modal focus/scroll handling and ARIA/touch-target fixes.
- [ ] Run focused tests, typecheck, and the controlled browser map scenario.

### Task 3: Recommendation correctness and home actions

**Files:**
- Modify: `frontend/src/features/client/map/branchLocations.ts`
- Modify: `frontend/src/features/client/ClientWorkspace.tsx`
- Modify: `frontend/src/features/client/map/liveBranches.ts`
- Test: `frontend/tests/geoRouting.test.mjs`
- Test: `frontend/tests/reliability.test.mjs`

**Interfaces:**
- Produces: `calculateBranchTotalTime` and validated recommendation/saving results in minutes.
- Consumes: valid shared GPS and fresh live workload only.

- [ ] Add failing cases for no GPS, NaN/Infinity/negative values, unit-sized outliers, nearest=fastest, positive savings, and appointment action eligibility.
- [ ] Run focused tests and confirm failure.
- [ ] Implement the shared duration helper and remove the neutral-coordinate recommendation path.
- [ ] Remove “Выбрать”; keep ticket/route and show appointment only after confirmed enabled services.
- [ ] Align desktop hero metadata with the title/subtitle block and keep mobile wrapping lightweight.
- [ ] Run focused tests and typecheck.

### Task 4: Scoped accessibility typography and mobile regression

**Files:**
- Modify: `frontend/src/components/common/ProductHeader.tsx`
- Modify: `frontend/src/product.css`
- Modify: `frontend/src/features/client/client.css`
- Modify: `frontend/src/features/client/map/BranchMapModal.tsx`
- Test: `frontend/tests/header_accessibility.test.mjs`
- Modify: `qa/sprint4/reliability-browser.mjs`
- Modify: `qa/sprint4/visual-regression.mjs`

**Interfaces:**
- Produces: `data-text-scale="100|125|150"` and scoped typography variables.
- Preserves: fixed marker/control/icon geometry and global focus-visible ring.

- [ ] Add failing assertions that root font size is untouched and marker geometry remains stable at all three scales.
- [ ] Replace root mutation with scoped text tokens and add disclosure/toggle ARIA and focus return in the mobile header.
- [ ] Add lazy/async image loading and truthful alternative text to branch thumbnails.
- [ ] Run tests and browser checks at 320, 360, 390, 430 and desktop widths for 100/125/150%.

### Task 5: OAuth state, demo restriction, and readiness

**Files:**
- Modify: `backend/internal/httpapi/oauth_handlers.go`
- Modify: `backend/internal/httpapi/router.go`
- Modify: `backend/internal/config/config.go`
- Modify: `backend/cmd/api/main.go`
- Modify: `docker-compose.yml`
- Test: `backend/internal/httpapi/oauth_handlers_test.go`
- Test: `backend/internal/httpapi/handlers_sprint3_test.go`
- Test: `backend/internal/config/config_test.go`

**Interfaces:**
- Produces: signed/random OAuth state cookie validation, environment-gated demo auth, schema-aware readiness.
- Consumes: configured environment, DB ping, and migration head 22.

- [ ] Add failing handler tests for state presence/match/mismatch/replay, secure cookie attributes, and production demo rejection.
- [ ] Add failing readiness tests for DB/schema unavailable and healthy schema 22.
- [ ] Implement random state issuance/validation and fail-closed production behavior without logging credentials.
- [ ] Make required migration failures stop startup and make Compose depend on `/ready`.
- [ ] Run backend unit tests, integration tests against the isolated QA database, and `go build ./...`.

### Task 6: Production static frontend and tracked proxy parity

**Files:**
- Modify: `frontend/Dockerfile`
- Create: `frontend/nginx.conf`
- Modify: `docker-compose.yml`
- Modify: `nginx/default.conf`
- Modify: `scripts/autopull.sh`
- Modify: `scripts/validate_env.sh`
- Test: `frontend/tests/local_proxy.test.mjs`

**Interfaces:**
- Produces: immutable Vite build served by container Nginx, SPA fallback, `/api` host-proxy compatibility, readiness-gated deployment.

- [ ] Add failing configuration tests that reject `vite --host` as the production command and require SPA/static cache rules and tracked OAuth proxy routing.
- [ ] Build a multi-stage frontend image and serve `dist` with Nginx.
- [ ] Preserve host Nginx `/api/` routing and synchronize the exact OAuth login location/forwarded headers.
- [ ] Make deployment fail before announcing success if migrations, `/ready`, or branches smoke checks fail.
- [ ] Build Compose images, run `nginx -t`, and smoke `/`, `/api/v1/branches`, `/health`, `/ready`, and OAuth redirect construction locally.

### Task 7: Catalogue honesty and audit report

**Files:**
- Modify: `frontend/src/features/client/map/branchLocations.ts`
- Modify: `frontend/src/features/client/map/BranchMapModal.tsx`
- Create: `docs/branch-catalogue-audit.md`
- Test: `frontend/tests/branch_map.test.mjs`

**Interfaces:**
- Produces: unambiguous `DEMO_ONLY` provenance for 25 catalogue records plus one legacy API record.

- [ ] Add failing assertions that unverified ratings/photos are not attributed to Yandex and catalogue counts/provenance are explicit.
- [ ] Remove misleading source copy and write the 26-row audit with IDs, addresses, coordinates, status, and provenance.
- [ ] Run catalogue/map tests and verify the live API count.

### Task 8: Full verification and read-only production comparison

**Files:**
- Modify only if a verification failure identifies an in-scope root cause.

- [ ] Run `npm test`, `npm run typecheck`, and `npm run build` in `frontend`.
- [ ] Run the controlled browser reliability and visual suites at all required viewports; inspect console and network failures.
- [ ] Run `go test ./...` and `go build ./...` in `backend`, plus database integration tests against the QA database.
- [ ] Run Compose build/config validation and local Nginx/API/OAuth smoke checks.
- [ ] Inspect `git diff --check`, `git status`, and the complete changed-file list.
- [ ] Recheck production read-only and report deployed commit/model separately; do not deploy without explicit authorization.

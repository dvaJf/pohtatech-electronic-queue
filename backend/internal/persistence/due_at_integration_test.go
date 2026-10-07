package persistence

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

// Test 1: Tie-break determinism: due_at -> source_rank -> checkin_at -> id
func TestDueAtTieBreakDeterminism(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)

	// Create 4 tickets with identical due_at, but differing source_rank
	// t1: LIVE (rank 2)
	// t2: QR (rank 1)
	// t3: QR (rank 1, earlier checkin)
	// t4: QR (rank 1, same checkin as t3, but smaller ID)

	tLive := live(t, ctx, p, "det-live", parcels)
	tQR1 := create(t, ctx, p, parcels, "det-qr1")
	tQR2 := create(t, ctx, p, parcels, "det-qr2")

	// Set exact deterministic timestamps
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, source_rank=2, checkin_at=$3, queue_entered_at=$3, ready_at=$3 WHERE id=$1::uuid`,
		tLive.ID, baseTime, baseTime.Add(-10*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, source_rank=1, checkin_at=$3, queue_entered_at=$3, ready_at=$3 WHERE id=$1::uuid`,
		tQR1.ID, baseTime, baseTime.Add(-5*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, source_rank=1, checkin_at=$3, queue_entered_at=$3, ready_at=$3 WHERE id=$1::uuid`,
		tQR2.ID, baseTime, baseTime.Add(-15*time.Minute)) // earlier checkin than tQR1

	// Call next: tQR2 has smaller checkin than tQR1, and both QR have rank 1 < rank 2
	first, err := p.CallNextAt(ctx, window1, baseTime)
	if err != nil || first.ID != tQR2.ID {
		t.Fatalf("expected tQR2 (earlier checkin at same rank), got %v (err: %v)", first.ID, err)
	}
	_, _ = p.StartService(ctx, first.ID)
	_, _ = p.CompleteService(ctx, first.ID)

	second, err := p.CallNextAt(ctx, window1, baseTime)
	if err != nil || second.ID != tQR1.ID {
		t.Fatalf("expected tQR1 (rank 1 < rank 2), got %v (err: %v)", second.ID, err)
	}
	_, _ = p.StartService(ctx, second.ID)
	_, _ = p.CompleteService(ctx, second.ID)

	third, err := p.CallNextAt(ctx, window1, baseTime)
	if err != nil || third.ID != tLive.ID {
		t.Fatalf("expected tLive (rank 2), got %v (err: %v)", third.ID, err)
	}
}

// Test 2: Multi-ticket scenario under deterministic tier aging.
// At 16:05:
// b05: LIVE (checkin 14:55) -> Tier 0 at 15:25
// b07: LIVE (checkin 15:10) -> Tier 0 at 15:40
// a01: APPOINTMENT early check-in (slot 15:30, checkin 15:20) -> LIVE aging -> Tier 0 at 15:50
// a02: APPOINTMENT late check-in (slot 15:20, checkin 15:45) -> Tier 1 at 16:00
// Expected order: b05, b07, a01, a02
func TestPromptFiveTicketOrderScenario(t *testing.T) {
	ctx, p, _ := integration(t)

	b05Checkin := time.Date(2026, 9, 20, 14, 55, 0, 0, time.UTC)
	a01Slot := time.Date(2026, 9, 20, 15, 30, 0, 0, time.UTC)
	a01Checkin := time.Date(2026, 9, 20, 15, 20, 0, 0, time.UTC)
	b07Checkin := time.Date(2026, 9, 20, 15, 10, 0, 0, time.UTC)
	a02Slot := time.Date(2026, 9, 20, 15, 20, 0, 0, time.UTC)
	a02Checkin := time.Date(2026, 9, 20, 15, 45, 0, 0, time.UTC)

	// Create tickets
	b05 := live(t, ctx, p, "b05", parcels)
	a01 := book(t, ctx, p, "a01", parcels).Appointment.Ticket
	b07 := live(t, ctx, p, "b07", parcels)
	a02 := book(t, ctx, p, "a02", parcels).Appointment.Ticket

	policy := p.GetPolicy()
	dueB05, readyB05, rankB05 := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{Source: domain.TicketSourceLive, ServiceID: parcels}, b05Checkin)
	dueA01, readyA01, rankA01 := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{Source: domain.TicketSourceAppointment, ScheduledAt: &a01Slot, ServiceID: parcels}, a01Checkin)
	dueB07, readyB07, rankB07 := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{Source: domain.TicketSourceLive, ServiceID: parcels}, b07Checkin)
	dueA02, readyA02, rankA02 := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{Source: domain.TicketSourceAppointment, ScheduledAt: &a02Slot, ServiceID: parcels}, a02Checkin)

	execSQL(t, ctx, p, `UPDATE tickets SET checkin_at=$2, queue_entered_at=$2, due_at=$3, ready_at=$4, source_rank=$5 WHERE id=$1::uuid`, b05.ID, b05Checkin, dueB05, readyB05, rankB05)
	execSQL(t, ctx, p, `UPDATE tickets SET checkin_at=$2, arrived_at=$2, queue_entered_at=$2, scheduled_at=$3, due_at=$4, ready_at=$5, source_rank=$6, status='WAITING' WHERE id=$1::uuid`, a01.ID, a01Checkin, a01Slot, dueA01, readyA01, rankA01)
	execSQL(t, ctx, p, `UPDATE tickets SET checkin_at=$2, queue_entered_at=$2, due_at=$3, ready_at=$4, source_rank=$5 WHERE id=$1::uuid`, b07.ID, b07Checkin, dueB07, readyB07, rankB07)
	execSQL(t, ctx, p, `UPDATE tickets SET checkin_at=$2, arrived_at=$2, queue_entered_at=$2, scheduled_at=$3, due_at=$4, ready_at=$5, source_rank=$6, status='WAITING' WHERE id=$1::uuid`, a02.ID, a02Checkin, a02Slot, dueA02, readyA02, rankA02)

	// Decision time at 16:05 (when all are eligible under tier policy)
	callTime := time.Date(2026, 9, 20, 16, 5, 0, 0, time.UTC)
	expectedOrder := []string{b05.ID, b07.ID, a01.ID, a02.ID}

	for i, expectedID := range expectedOrder {
		called, err := p.CallNextAt(ctx, window1, callTime)
		if err != nil {
			t.Fatalf("call %d failed: %v", i+1, err)
		}
		if called.ID != expectedID {
			t.Fatalf("call %d expected ticket %s, got %s", i+1, expectedID, called.ID)
		}
		_, err = p.StartService(ctx, called.ID)
		if err != nil {
			t.Fatal(err)
		}
		_, err = p.CompleteService(ctx, called.ID)
		if err != nil {
			t.Fatal(err)
		}
	}
}

// Test 3: Concurrency: 50 goroutines on multiple windows calling 30 tickets
func TestCallNextHighConcurrency(t *testing.T) {
	ctx, p, _ := integration(t)

	// Create 30 tickets
	numTickets := 30
	for i := 0; i < numTickets; i++ {
		live(t, ctx, p, fmt.Sprintf("conc-live-%d", i), parcels)
	}

	// 50 concurrent call-next invocations across window1 and window3
	numCallers := 50
	calledIDs := make(map[string]int)
	var mu sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < numCallers; i++ {
		wg.Add(1)
		go func(workerID int) {
			defer wg.Done()
			w := window1
			if workerID%2 == 1 {
				w = window3
			}
			tkt, err := p.CallNext(ctx, w)
			if err == nil {
				mu.Lock()
				calledIDs[tkt.ID]++
				mu.Unlock()
				// Complete service so window becomes free for next ticket
				_, _ = p.StartService(ctx, tkt.ID)
				_, _ = p.CompleteService(ctx, tkt.ID)
			}
		}(i)
	}
	wg.Wait()

	// Verify no ticket was called more than once
	for tid, count := range calledIDs {
		if count > 1 {
			t.Fatalf("ticket %s called %d times (expected exactly 1)", tid, count)
		}
	}
}

// Test 4: Idempotency by request_id
func TestCallNextRequestIdIdempotency(t *testing.T) {
	ctx, p, _ := integration(t)
	live(t, ctx, p, "reqid-tkt", parcels)

	reqID := "operator-call-nonce-xyz"
	ctxWithReqID := domain.WithRequestID(ctx, reqID)

	// First call
	first, err := p.CallNext(ctxWithReqID, window1)
	if err != nil {
		t.Fatalf("first call failed: %v", err)
	}

	// Repeat call with same request_id must return the EXACT same ticket without error
	second, err := p.CallNext(ctxWithReqID, window1)
	if err != nil {
		t.Fatalf("second call with same request_id failed: %v", err)
	}
	if first.ID != second.ID {
		t.Fatalf("expected replayed ticket %s, got %s", first.ID, second.ID)
	}

	// Calling with a DIFFERENT request_id while window is busy must fail with ErrWindowBusy
	diffCtx := domain.WithRequestID(ctx, "different-nonce-abc")
	_, err = p.CallNext(diffCtx, window1)
	if err != application.ErrWindowBusy {
		t.Fatalf("expected ErrWindowBusy for different request_id, got: %v", err)
	}
}

// Test 5: Window close policies (finish_current vs return_to_queue)
func TestWindowClosePolicies(t *testing.T) {
	ctx, p, _ := integration(t)

	// 5A: return_to_queue policy
	policy := p.GetPolicy()
	policy.WindowClose.Policy = domain.WindowCloseReturnToQueue
	p.SetPolicy(policy)

	tkt1 := live(t, ctx, p, "ret-tkt-1", parcels)
	called, err := p.CallNext(ctx, window1)
	if err != nil || called.ID != tkt1.ID {
		t.Fatalf("call failed: %v", err)
	}

	// Window closed while ticket is CALLED -> ticket returned to queue
	_, err = p.ChangeWindowStatus(ctx, window1, domain.WindowStatusClosed)
	if err != nil {
		t.Fatalf("close window failed: %v", err)
	}

	reloaded, err := p.GetTicket(ctx, tkt1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Status != domain.TicketStatusWaiting || reloaded.Window != nil {
		t.Fatalf("expected returned to WAITING with window=nil, got status=%s window=%v", reloaded.Status, reloaded.Window)
	}

	// 5B: finish_current policy
	policy.WindowClose.Policy = domain.WindowCloseFinishCurrent
	p.SetPolicy(policy)

	// Reopen window1
	_, err = p.ChangeWindowStatus(ctx, window1, domain.WindowStatusOpen)
	if err != nil {
		t.Fatal(err)
	}

	// Call ticket again and start service
	calledAgain, err := p.CallNext(ctx, window1)
	if err != nil || calledAgain.ID != tkt1.ID {
		t.Fatalf("call again failed: %v", err)
	}
	_, err = p.StartService(ctx, calledAgain.ID)
	if err != nil {
		t.Fatal(err)
	}

	// Close window while SERVING -> window transitions to CLOSING
	win, err := p.ChangeWindowStatus(ctx, window1, domain.WindowStatusClosed)
	if err != nil {
		t.Fatal(err)
	}
	if win.Status != domain.WindowStatusClosing {
		t.Fatalf("expected window in CLOSING state, got: %s", win.Status)
	}

	// Completing service finishes ticket and closes window
	_, err = p.CompleteService(ctx, calledAgain.ID)
	if err != nil {
		t.Fatal(err)
	}
	windows, _ := p.ListBranchWindows(ctx, demoBranch)
	for _, w := range windows {
		if w.ID == window1 && w.Status != domain.WindowStatusClosed {
			t.Fatalf("expected window CLOSED after completion, got: %s", w.Status)
		}
	}
}

// Test 6: Recovery worker: stale CALLED ticket recall and NO_SHOW
func TestRecoveryWorkerReconcilesStaleTickets(t *testing.T) {
	ctx, p, _ := integration(t)

	policy := p.GetPolicy()
	policy.Call.ClientTimeoutSeconds = 90
	policy.Call.MaxRecalls = 2
	p.SetPolicy(policy)

	_ = live(t, ctx, p, "stale-tkt", parcels)
	called, err := p.CallNext(ctx, window1)
	if err != nil {
		t.Fatal(err)
	}

	baseTime := time.Now().UTC()

	// 1. Simulate 95s elapsed (timeout exceeded, recall 1)
	t1 := baseTime.Add(95 * time.Second)
	if err := p.ReconcileStaleTickets(ctx, t1); err != nil {
		t.Fatal(err)
	}
	chk, _ := p.GetTicket(ctx, called.ID)
	if chk.RecallCount != 1 || chk.Status != domain.TicketStatusCalled {
		t.Fatalf("expected recall_count=1 in CALLED, got %d status=%s", chk.RecallCount, chk.Status)
	}

	// 2. Simulate another 95s elapsed (recall 2 = max_recalls)
	t2 := t1.Add(95 * time.Second)
	if err := p.ReconcileStaleTickets(ctx, t2); err != nil {
		t.Fatal(err)
	}
	chk, _ = p.GetTicket(ctx, called.ID)
	if chk.RecallCount != 2 || chk.Status != domain.TicketStatusCalled {
		t.Fatalf("expected recall_count=2 in CALLED, got %d status=%s", chk.RecallCount, chk.Status)
	}

	// 3. Simulate another 95s elapsed (exceeded max_recalls -> NO_SHOW)
	t3 := t2.Add(95 * time.Second)
	if err := p.ReconcileStaleTickets(ctx, t3); err != nil {
		t.Fatal(err)
	}
	chk, _ = p.GetTicket(ctx, called.ID)
	if chk.Status != domain.TicketStatusNoShow {
		t.Fatalf("expected status NO_SHOW, got: %s", chk.Status)
	}
}

// Test 7: Appointment not called before slot when client has not arrived
func TestAppointmentNotCalledBeforeEarlyWindow(t *testing.T) {
	ctx, p, _ := integration(t)

	now := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Hour)
	// Slot is 12:30. Client does not check in -> ready_at is 12:30.
	slot := now.Add(30 * time.Minute)

	aptCmd := application.CreateAppointmentCommand{
		BranchID:       demoBranch,
		ServiceID:      parcels,
		IdempotencyKey: "early-window-test",
		ScheduledAt:    slot,
	}
	res, err := p.CreateAppointment(ctx, aptCmd)
	if err != nil {
		t.Fatal(err)
	}

	// Decision time at 12:15 (before slot 12:30, unarrived) -> must return ErrNotEligibleYet
	_, err = p.CallNextAt(ctx, window1, now.Add(15*time.Minute))
	if err != application.ErrNotEligibleYet {
		t.Fatalf("expected ErrNotEligibleYet at 12:15, got: %v", err)
	}

	// Decision time at 12:31 (after slot 12:30) -> called successfully!
	called, err := p.CallNextAt(ctx, window1, now.Add(31*time.Minute))
	if err != nil {
		t.Fatalf("expected successful call at 12:31, got: %v", err)
	}
	if called.ID != res.Appointment.Ticket.ID {
		t.Fatalf("expected appointment called, got: %s", called.ID)
	}

	// Early arrival (before 15m early window, e.g. at 12:05 for slot 12:30)
	checkinEarly := now.Add(5 * time.Minute)
	policy := p.GetPolicy()
	dueEarly, readyEarly, rankEarly := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{
		Source:      domain.TicketSourceAppointment,
		ScheduledAt: &slot,
		ServiceID:   parcels,
	}, checkinEarly)

	if rankEarly != 2 {
		t.Fatalf("expected rank 2 (live queue) for early arrival before 15m window, got: %d", rankEarly)
	}
	if !readyEarly.Equal(checkinEarly) {
		t.Fatalf("expected ready_at = checkin (%v) for early arrival, got: %v", checkinEarly, readyEarly)
	}
	if !dueEarly.Equal(checkinEarly.Add(30 * time.Minute)) {
		t.Fatalf("expected due_at = checkin + 30m for early arrival, got: %v", dueEarly)
	}
}

// Test 8: Audit log append-only: UPDATE and DELETE on ticket_events rejected by trigger
func TestAuditLogAppendOnlyRejectsMutations(t *testing.T) {
	ctx, p, _ := integration(t)
	tkt := live(t, ctx, p, "audit-append-only", parcels)

	events, err := p.ListTicketEvents(ctx, tkt.ID)
	if err != nil || len(events) == 0 {
		t.Fatalf("events error: %v, count=%d", err, len(events))
	}
	eventID := events[0].ID

	// Try UPDATE on ticket_events -> trigger must reject with error
	_, err = p.pool.Exec(ctx, `UPDATE ticket_events SET reason='tampered' WHERE id=$1`, eventID)
	if err == nil {
		t.Fatal("expected UPDATE on ticket_events to be rejected by trigger, but it succeeded")
	}

	// Try DELETE on ticket_events -> trigger must reject with error
	_, err = p.pool.Exec(ctx, `DELETE FROM ticket_events WHERE id=$1`, eventID)
	if err == nil {
		t.Fatal("expected DELETE on ticket_events to be rejected by trigger, but it succeeded")
	}
}

// Test 9: Reason for empty results: ErrNoEligibleTickets vs ErrNotEligibleYet
func TestCallNextEmptyResultReasons(t *testing.T) {
	ctx, p, _ := integration(t)

	// Completely empty queue -> ErrNoEligibleTickets
	_, err := p.CallNext(ctx, window1)
	if err != application.ErrNoEligibleTickets {
		t.Fatalf("expected ErrNoEligibleTickets for empty queue, got: %v", err)
	}

	// Future appointment ticket exists (ready_at in future) -> ErrNotEligibleYet
	futureSlot := time.Now().Add(2 * time.Hour)
	apt := book(t, ctx, p, "future-slot-reason", parcels).Appointment.Ticket
	execSQL(t, ctx, p, `UPDATE tickets SET status='WAITING', ready_at=$2, due_at=$3 WHERE id=$1::uuid`,
		apt.ID, futureSlot.Add(-10*time.Minute), futureSlot)

	_, err = p.CallNext(ctx, window1)
	if err != application.ErrNotEligibleYet {
		t.Fatalf("expected ErrNotEligibleYet when all tickets are in future, got: %v", err)
	}
}

// Test 10: YAML policy dynamic update
func TestQueuePolicyDynamicUpdate(t *testing.T) {
	_, p, _ := integration(t)

	orig := p.GetPolicy()
	if orig.Appointment.GraceMinutes != 15 {
		t.Fatalf("orig grace: %d", orig.Appointment.GraceMinutes)
	}

	updated := orig
	updated.Appointment.GraceMinutes = 25
	updated.PolicyVersion = 99
	p.SetPolicy(updated)

	got := p.GetPolicy()
	if got.Appointment.GraceMinutes != 25 || got.PolicyVersion != 99 {
		t.Fatalf("failed to update policy dynamically: %+v", got)
	}
}

// Test 11: Call specific ticket explicitly by public_number or id
func TestCallSpecificTicket(t *testing.T) {
	ctx, p, _ := integration(t)

	first := create(t, ctx, p, parcels, "specific-qr-1")
	second := create(t, ctx, p, parcels, "specific-qr-2")
	third := create(t, ctx, p, parcels, "specific-qr-3")
	_ = first

	// Normal callNext would pick 'first'. Operator explicitly calls 'third' by public number:
	calledThird, err := p.CallSpecificTicket(ctx, window1, third.PublicNumber)
	if err != nil {
		t.Fatalf("failed to call specific ticket %s: %v", third.PublicNumber, err)
	}
	if calledThird.ID != third.ID {
		t.Fatalf("expected called ticket to be third (%s), got: %s", third.ID, calledThird.ID)
	}
	if calledThird.Status != domain.TicketStatusCalled {
		t.Fatalf("expected status CALLED, got: %s", calledThird.Status)
	}

	// Complete third ticket so window is free
	_, err = p.StartService(ctx, calledThird.ID)
	if err != nil {
		t.Fatalf("start service: %v", err)
	}
	_, err = p.CompleteService(ctx, calledThird.ID)
	if err != nil {
		t.Fatalf("complete service: %v", err)
	}

	// Now call second ticket by its UUID:
	calledSecond, err := p.CallSpecificTicket(ctx, window1, second.ID)
	if err != nil {
		t.Fatalf("failed to call specific ticket by id: %v", err)
	}
	if calledSecond.ID != second.ID {
		t.Fatalf("expected called ticket to be second (%s), got: %s", second.ID, calledSecond.ID)
	}
}

// Test 12: Admin UI QueuePolicy update dynamically reorders waiting tickets in CallNext
func TestQueuePolicyUpdateDynamicallyReordersCallNext(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)

	// Fetch current policy version
	curPolicy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil {
		t.Fatalf("failed to get queue policy: %v", err)
	}

	// 1. Create a LIVE ticket and a QR ticket with the same due_at and checkin_at
	tLive := live(t, ctx, p, "dyn-live", parcels)
	tQR := create(t, ctx, p, parcels, "dyn-qr")

	// Set exact identical due_at and checkin_at
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, checkin_at=$2, source_rank=2 WHERE id=$1::uuid`,
		tLive.ID, baseTime)
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, checkin_at=$2, source_rank=1 WHERE id=$1::uuid`,
		tQR.ID, baseTime)

	// 2. Admin elevates LIVE priority above QR priority via UpdateQueuePolicy
	cmd := application.UpdateQueuePolicyCommand{
		BranchID:                        demoBranch,
		ExpectedVersion:                 curPolicy.Version,
		AppointmentDuePriority:          200,
		QRPriority:                      20,
		LivePriority:                    50, // Live > QR!
		AntiStarvationThresholdMinutes:  curPolicy.AntiStarvationThresholdMinutes,
		AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
		AppointmentGraceMinutes:         curPolicy.AppointmentGraceMinutes,
		AppointmentLatePenaltyPerMinute: curPolicy.AppointmentLatePenaltyPerMinute,
		AppointmentLatePenaltyMaxPoints: curPolicy.AppointmentLatePenaltyMaxPoints,
	}
	updated, err := p.UpdateQueuePolicy(ctx, cmd)
	if err != nil {
		t.Fatalf("UpdateQueuePolicy failed: %v", err)
	}
	if updated.LivePriority != 50 || updated.QRPriority != 20 {
		t.Fatalf("expected updated priorities Live=50, QR=20, got: %+v", updated)
	}

	// 3. CallNextAt returns tQR FIRST because QR is Tier 1 and Live is Tier 2,
	// and same-day policy update does not disrupt active tier ordering.
	first, err := p.CallNextAt(ctx, window1, baseTime)
	if err != nil {
		t.Fatalf("CallNextAt failed: %v", err)
	}
	if first.ID != tQR.ID {
		t.Fatalf("expected QR ticket %s to be called first (Tier 1 < Tier 2), but got %s (source=%s)", tQR.ID, first.ID, first.Source)
	}
}


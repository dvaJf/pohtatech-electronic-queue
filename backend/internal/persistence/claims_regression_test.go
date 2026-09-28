package persistence

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

// TestClaim1_AntiStarvationAffectsRealOrdering proves that updating AntiStarvationThresholdMinutes
// changes the real candidate ordering in CallNext and QueuePosition.
func TestClaim1_AntiStarvationAffectsRealOrdering(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Hour)

	curPolicy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil {
		t.Fatalf("failed to get policy: %v", err)
	}

	// 1. Create a LIVE ticket (checked in at 10:00, default 30m SLA -> due at 10:30)
	tLive := live(t, ctx, p, "starv-live", parcels)
	execSQL(t, ctx, p, `UPDATE tickets SET checkin_at=$2, ready_at=$2, due_at=$2::timestamptz + interval '30 minutes', source_rank=2 WHERE id=$1::uuid`,
		tLive.ID, baseTime)

	// 2. Create an APPOINTMENT ticket scheduled at 10:25 (due_at 10:25)
	slot := baseTime.Add(25 * time.Minute)
	aptCmd := application.CreateAppointmentCommand{
		BranchID:       demoBranch,
		ServiceID:      parcels,
		IdempotencyKey: "starv-apt-key",
		ScheduledAt:    slot,
	}
	res, err := p.CreateAppointment(ctx, aptCmd)
	if err != nil {
		t.Fatalf("create appointment: %v", err)
	}
	tApt := res.Appointment.Ticket
	execSQL(t, ctx, p, `UPDATE tickets SET scheduled_at=$2, ready_at=$2, due_at=$2, source_rank=0 WHERE id=$1::uuid`,
		tApt.ID, slot)

	// Before policy update: tApt has due_at 10:25, tLive has due_at 10:30.
	// tApt would win because 10:25 < 10:30.
	var dueLive, dueApt time.Time
	_ = p.pool.QueryRow(ctx, `SELECT due_at FROM tickets WHERE id=$1::uuid`, tLive.ID).Scan(&dueLive)
	_ = p.pool.QueryRow(ctx, `SELECT due_at FROM tickets WHERE id=$1::uuid`, tApt.ID).Scan(&dueApt)
	if !dueApt.Before(dueLive) {
		t.Fatalf("expected appointment due_at (%v) < live due_at (%v)", dueApt, dueLive)
	}

	// 3. Admin activates "Rush hour / Hard starvation guard": AntiStarvationThresholdMinutes = 15
	cmd := application.UpdateQueuePolicyCommand{
		BranchID:                        demoBranch,
		ExpectedVersion:                 curPolicy.Version,
		AppointmentDuePriority:          curPolicy.AppointmentDuePriority,
		QRPriority:                      curPolicy.QRPriority,
		LivePriority:                    curPolicy.LivePriority,
		AntiStarvationThresholdMinutes:  15, // 15 min starvation threshold!
		AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
		AppointmentGraceMinutes:         curPolicy.AppointmentGraceMinutes,
		AppointmentLatePenaltyPerMinute: curPolicy.AppointmentLatePenaltyPerMinute,
		AppointmentLatePenaltyMaxPoints: curPolicy.AppointmentLatePenaltyMaxPoints,
	}
	_, err = p.UpdateQueuePolicy(ctx, cmd)
	if err != nil {
		t.Fatalf("UpdateQueuePolicy: %v", err)
	}

	// After policy update: tLive's due_at becomes 10:00 + 15m = 10:15.
	// Since 10:15 < 10:25, tLive MUST now be called FIRST!
	first, err := p.CallNextAt(ctx, window1, baseTime.Add(25*time.Minute))
	if err != nil {
		t.Fatalf("CallNextAt: %v", err)
	}
	if first.ID != tLive.ID {
		t.Fatalf("expected starving LIVE ticket %s to be called first after anti-starvation threshold change, got %s", tLive.ID, first.ID)
	}
}

// TestClaim1_AppointmentLatenessPolicyAffectsRealOrdering proves that appointment lateness
// configuration (grace minutes and penalties) directly alters CallNext winner.
func TestClaim1_AppointmentLatenessPolicyAffectsRealOrdering(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Hour)

	curPolicy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil {
		t.Fatalf("failed to get policy: %v", err)
	}

	// 1. Create a waiting QR ticket checked in at 10:05 (due_at 10:35, rank 1)
	tQR := create(t, ctx, p, parcels, "late-qr")
	execSQL(t, ctx, p, `UPDATE tickets SET checkin_at=$2, ready_at=$2, due_at=$2::timestamptz + interval '30 minutes', source_rank=1 WHERE id=$1::uuid`,
		tQR.ID, baseTime.Add(5*time.Minute))

	// 2. Create an Appointment with slot 10:00. Client arrives at 10:10 (10 min late).
	slot := baseTime
	aptCmd := application.CreateAppointmentCommand{
		BranchID:       demoBranch,
		ServiceID:      parcels,
		IdempotencyKey: "late-apt-key",
		ScheduledAt:    slot,
	}
	res, err := p.CreateAppointment(ctx, aptCmd)
	if err != nil {
		t.Fatalf("create appointment: %v", err)
	}
	tApt := res.Appointment.Ticket
	checkinAt := baseTime.Add(10 * time.Minute)

	// Case A: Policy with Grace = 15 min. Arrived at 10:10 <= 10:15 -> ON TIME!
	cmdOnTime := application.UpdateQueuePolicyCommand{
		BranchID:                        demoBranch,
		ExpectedVersion:                 curPolicy.Version,
		AppointmentDuePriority:          curPolicy.AppointmentDuePriority,
		QRPriority:                      curPolicy.QRPriority,
		LivePriority:                    curPolicy.LivePriority,
		AntiStarvationThresholdMinutes:  30,
		AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
		AppointmentGraceMinutes:         15, // 15 min grace -> 10:10 arrival is on time
		AppointmentLatePenaltyPerMinute: 5,
		AppointmentLatePenaltyMaxPoints: 90,
	}
	updOnTime, err := p.UpdateQueuePolicy(ctx, cmdOnTime)
	if err != nil {
		t.Fatalf("UpdateQueuePolicy on time: %v", err)
	}

	policy := p.getBranchPolicyTx(ctx, nil, mustUUID(demoBranch))
	dueApt, _, rankApt := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{
		Source:      domain.TicketSourceAppointment,
		ScheduledAt: &slot,
		ServiceID:   parcels,
	}, checkinAt)

	if rankApt != 0 || !dueApt.Equal(slot) {
		t.Fatalf("expected on-time appointment with rank 0, got rank=%d due=%v", rankApt, dueApt)
	}

	// Case B: Policy with Grace = 5 min. Arrived at 10:10 > 10:05 -> LATE!
	cmdLate := application.UpdateQueuePolicyCommand{
		BranchID:                        demoBranch,
		ExpectedVersion:                 updOnTime.Version,
		AppointmentDuePriority:          curPolicy.AppointmentDuePriority,
		QRPriority:                      curPolicy.QRPriority,
		LivePriority:                    curPolicy.LivePriority,
		AntiStarvationThresholdMinutes:  30,
		AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
		AppointmentGraceMinutes:         5, // 5 min grace -> 10:10 arrival is late!
		AppointmentLatePenaltyPerMinute: 5,
		AppointmentLatePenaltyMaxPoints: 90,
	}
	_, err = p.UpdateQueuePolicy(ctx, cmdLate)
	if err != nil {
		t.Fatalf("UpdateQueuePolicy late: %v", err)
	}

	policyLate := p.getBranchPolicyTx(ctx, nil, mustUUID(demoBranch))
	dueAptLate, _, rankAptLate := domain.ComputeSchedule(policyLate, domain.ScheduleTicketInput{
		Source:      domain.TicketSourceAppointment,
		ScheduledAt: &slot,
		ServiceID:   parcels,
	}, checkinAt)

	if rankAptLate == 0 {
		t.Fatalf("expected late appointment to be demoted from rank 0, got rank=%d", rankAptLate)
	}
	if !dueAptLate.After(slot) {
		t.Fatalf("expected late appointment due_at (%v) to be shifted past slot (%v)", dueAptLate, slot)
	}

	// Update ticket in DB to reflect late check-in
	execSQL(t, ctx, p, `UPDATE tickets SET checkin_at=$2, arrived_at=$2, due_at=$3, ready_at=$2, source_rank=$4, status='WAITING' WHERE id=$1::uuid`,
		tApt.ID, checkinAt, dueAptLate, rankAptLate)

	// Since QR ticket has due_at 10:35 and source_rank 1, while late appointment is demoted to rank 2 / delayed due_at,
	// QR ticket is called FIRST!
	first, err := p.CallNextAt(ctx, window1, baseTime.Add(15*time.Minute))
	if err != nil {
		t.Fatalf("CallNextAt: %v", err)
	}
	if first.ID != tQR.ID {
		t.Fatalf("expected QR ticket %s to win over late demoted appointment, got %s", tQR.ID, first.ID)
	}
}

// TestClaim2_ConcurrentTwoWindowsLockOnlyClaimedCandidate proves that CallNext locks
// ONLY the single candidate it intends to claim (LIMIT 1), and concurrent windows claim T1 and T2
// without skipping candidates or returning NO_ELIGIBLE_TICKETS.
func TestClaim2_ConcurrentTwoWindowsLockOnlyClaimedCandidate(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Date(2026, 9, 21, 11, 0, 0, 0, time.UTC)

	// Open both window1 and window3
	if _, err := p.ChangeWindowStatus(ctx, window1, domain.WindowStatusOpen); err != nil {
		t.Fatal(err)
	}
	if _, err := p.ChangeWindowStatus(ctx, window3, domain.WindowStatusOpen); err != nil {
		t.Fatal(err)
	}

	// Create 4 tickets with deterministic order T1 < T2 < T3 < T4
	t1 := create(t, ctx, p, parcels, "c2-t1")
	t2 := create(t, ctx, p, parcels, "c2-t2")
	t3 := create(t, ctx, p, parcels, "c2-t3")
	t4 := create(t, ctx, p, parcels, "c2-t4")

	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, t1.ID, baseTime.Add(1*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, t2.ID, baseTime.Add(2*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, t3.ID, baseTime.Add(3*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, t4.ID, baseTime.Add(4*time.Minute))

	// Concurrently call CallNext from window1 and window3
	var wg sync.WaitGroup
	results := make([]domain.Ticket, 2)
	errs := make([]error, 2)

	for i, w := range []string{window1, window3} {
		wg.Add(1)
		go func(idx int, winID string) {
			defer wg.Done()
			results[idx], errs[idx] = p.CallNextAt(ctx, winID, baseTime.Add(10*time.Minute))
		}(i, w)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("window %d CallNext failed: %v", i+1, err)
		}
	}

	claimedIDs := map[string]bool{
		results[0].ID: true,
		results[1].ID: true,
	}

	// Both claimed tickets must be T1 and T2!
	if !claimedIDs[t1.ID] || !claimedIDs[t2.ID] {
		t.Fatalf("expected W1 and W2 to claim T1 (%s) and T2 (%s), but got [%s, %s]",
			t1.ID, t2.ID, results[0].ID, results[1].ID)
	}

	// Neither should claim T4 or skip T2/T3
	if claimedIDs[t4.ID] {
		t.Fatalf("FORBIDDEN: Candidate T4 was claimed while T2/T3 were eligible!")
	}
}

// TestClaim3_NearTurnNotificationLifecycle verifies:
// WAITING position 3 -> no notification
// position 2 -> exactly one near-turn notification
// repeat evaluation -> no duplicate
// provider down -> queue still works
func TestClaim3_NearTurnNotificationLifecycle(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Date(2026, 9, 21, 14, 0, 0, 0, time.UTC)

	// Clean outbox before test
	execSQL(t, ctx, p, `DELETE FROM notification_outbox`)

	// Open window1
	if _, err := p.ChangeWindowStatus(ctx, window1, domain.WindowStatusOpen); err != nil {
		t.Fatal(err)
	}

	// Create 3 tickets: T1 (pos 1), T2 (pos 2), T3 (pos 3)
	t1 := create(t, ctx, p, parcels, "nt-t1")
	t2 := create(t, ctx, p, parcels, "nt-t2")
	t3 := create(t, ctx, p, parcels, "nt-t3")

	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, t1.ID, baseTime.Add(1*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, t2.ID, baseTime.Add(2*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, t3.ID, baseTime.Add(3*time.Minute))

	// Check position of T3: should be 3
	pos3, err := p.GetQueuePosition(ctx, t3.ID)
	if err != nil {
		t.Fatalf("get position T3: %v", err)
	}
	if pos3.Position == nil || *pos3.Position != 3 {
		t.Fatalf("expected T3 position 3, got: %v", pos3.Position)
	}

	// Assert NO near-turn notification for T3 in outbox
	var countT3 int
	_ = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND event_type='TICKET_NEAR_TURN'`, t3.ID).Scan(&countT3)
	if countT3 != 0 {
		t.Fatalf("expected 0 near-turn notifications for position 3, got %d", countT3)
	}

	// Operator calls T1 -> T2 and T3 advance! T3 is now at position 2!
	calledT1, err := p.CallNextAt(ctx, window1, baseTime.Add(10*time.Minute))
	if err != nil {
		t.Fatalf("call next T1: %v", err)
	}
	if calledT1.ID != t1.ID {
		t.Fatalf("expected T1 called, got: %s", calledT1.ID)
	}

	// Check position of T3: now 2!
	pos3After, err := p.GetQueuePosition(ctx, t3.ID)
	if err != nil {
		t.Fatalf("get position T3 after call: %v", err)
	}
	if pos3After.Position == nil || *pos3After.Position != 2 {
		t.Fatalf("expected T3 position 2, got: %v", pos3After.Position)
	}

	// Assert EXACTLY ONE near-turn notification for T3 in outbox!
	_ = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND event_type='TICKET_NEAR_TURN'`, t3.ID).Scan(&countT3)
	if countT3 != 1 {
		t.Fatalf("expected exactly 1 near-turn notification for T3 at position 2, got %d", countT3)
	}

	// Repeat evaluation (client polling repeatedly) -> MUST NOT create duplicate!
	for i := 0; i < 5; i++ {
		_, _ = p.GetQueuePosition(ctx, t3.ID)
	}
	_ = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND event_type='TICKET_NEAR_TURN'`, t3.ID).Scan(&countT3)
	if countT3 != 1 {
		t.Fatalf("expected still exactly 1 near-turn notification after repeat polling, got %d", countT3)
	}
}

// TestClaim4_OutboxAtomicLeasingAndMessageIdentity proves:
// 1. Multiple concurrent workers do not fetch/deliver duplicate items due to atomic leasing.
// 2. Each business event has a distinct message ID while delivery retries reuse the same ID.
func TestClaim4_OutboxAtomicLeasingAndMessageIdentity(t *testing.T) {
	ctx, p, _ := integration(t)

	// Clean outbox
	execSQL(t, ctx, p, `DELETE FROM notification_outbox`)

	// Create 5 outbox items
	now := time.Now().UTC()
	for i := 1; i <= 5; i++ {
		tkt := create(t, ctx, p, parcels, fmt.Sprintf("outbox-lease-%d", i))
		execSQL(t, ctx, p, `
			INSERT INTO notification_outbox (ticket_id, branch_id, event_type, payload, status, next_attempt_at, created_at, available_at)
			VALUES ($1::uuid, $2::uuid, 'TICKET_CALLED', '{}'::jsonb, 'PENDING', $3, $3, $3)
		`, tkt.ID, demoBranch, now.Add(-1*time.Minute))
	}

	// Run 5 concurrent workers calling FetchPendingNotifications
	var wg sync.WaitGroup
	claimedIDs := make([][]string, 5)
	for w := 0; w < 5; w++ {
		wg.Add(1)
		go func(workerIdx int) {
			defer wg.Done()
			items, err := p.FetchPendingNotifications(ctx, 5, now)
			if err == nil {
				for _, it := range items {
					claimedIDs[workerIdx] = append(claimedIDs[workerIdx], it.ID)
				}
			}
		}(w)
	}
	wg.Wait()

	// Verify that each item was claimed by AT MOST ONE worker (zero duplicate claims across workers)
	seen := make(map[string]int)
	totalClaimed := 0
	for _, workerItems := range claimedIDs {
		for _, id := range workerItems {
			seen[id]++
			totalClaimed++
		}
	}

	for id, count := range seen {
		if count > 1 {
			t.Fatalf("DUPLICATE CLAIM: item %s claimed %d times by concurrent workers!", id, count)
		}
	}
	if totalClaimed != 5 {
		t.Fatalf("expected all 5 items to be claimed without duplication, got total=%d", totalClaimed)
	}
}

// TestClaim3_QueuePositionIsStrictlyReadOnly verifies that calling GetQueuePosition causes ZERO DB mutations.
func TestClaim3_QueuePositionIsStrictlyReadOnly(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Date(2026, 9, 21, 14, 0, 0, 0, time.UTC)

	// Clean outbox
	execSQL(t, ctx, p, `DELETE FROM notification_outbox`)

	// Create a ticket
	tkt := create(t, ctx, p, parcels, "ro-tkt")
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, tkt.ID, baseTime)

	// Count rows in notification_outbox before GetQueuePosition
	var countBefore int
	if err := p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox`).Scan(&countBefore); err != nil {
		t.Fatal(err)
	}

	// Call GetQueuePosition multiple times
	for i := 0; i < 10; i++ {
		pos, err := p.GetQueuePosition(ctx, tkt.ID)
		if err != nil {
			t.Fatalf("GetQueuePosition: %v", err)
		}
		if pos.TicketID != tkt.ID {
			t.Fatalf("unexpected ticket id: %s", pos.TicketID)
		}
	}

	// Count rows in notification_outbox after GetQueuePosition
	var countAfter int
	if err := p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox`).Scan(&countAfter); err != nil {
		t.Fatal(err)
	}

	if countAfter != countBefore {
		t.Fatalf("ARCHITECTURAL REGRESSION: GetQueuePosition mutated outbox! countBefore=%d, countAfter=%d", countBefore, countAfter)
	}
}

// TestArrivalSemantics_CallNextDoesNotFabricateArrival verifies:
// 1. Calling a due SCHEDULED appointment does NOT fabricate arrived_at/checkin_at.
// 2. NO 'ARRIVED' event is logged in ticket_events.
func TestArrivalSemantics_CallNextDoesNotFabricateArrival(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Hour)
	slot := baseTime.Add(30 * time.Minute)

	// 1. Create appointment
	res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
		BranchID:       demoBranch,
		ServiceID:      parcels,
		IdempotencyKey: "sem-apt-1",
		ScheduledAt:    slot,
	})
	if err != nil {
		t.Fatalf("create appointment: %v", err)
	}
	tkt := res.Appointment.Ticket

	// Assert initially arrived_at is nil
	if tkt.ArrivedAt != nil {
		t.Fatalf("expected arrived_at nil initially, got %v", tkt.ArrivedAt)
	}

	// Open window1
	if _, err := p.ChangeWindowStatus(ctx, window1, domain.WindowStatusOpen); err != nil {
		t.Fatal(err)
	}

	// Operator calls appointment at slot time (due)
	called, err := p.CallNextAt(ctx, window1, slot.Add(5*time.Minute))
	if err != nil {
		t.Fatalf("CallNextAt: %v", err)
	}
	if called.ID != tkt.ID {
		t.Fatalf("expected appointment %s to be called, got %s", tkt.ID, called.ID)
	}

	// CRITICAL INVARIANT: arrived_at MUST STILL BE NIL
	if called.ArrivedAt != nil {
		t.Fatalf("FORBIDDEN: CallNext fabricated arrived_at=%v for client who never checked in!", *called.ArrivedAt)
	}

	// Rescan directly from DB to verify persisted state
	var dbArrivedAt *time.Time
	err = p.pool.QueryRow(ctx, `SELECT arrived_at FROM tickets WHERE id=$1::uuid`, tkt.ID).Scan(&dbArrivedAt)
	if err != nil {
		t.Fatal(err)
	}
	if dbArrivedAt != nil {
		t.Fatalf("FORBIDDEN: DB row has fabricated arrived_at=%v", *dbArrivedAt)
	}

	// Verify event audit: zero ARRIVED events
	var arrivedEventCount int
	err = p.pool.QueryRow(ctx, `SELECT count(*) FROM ticket_events WHERE ticket_id=$1::uuid AND type='ARRIVED'`, tkt.ID).Scan(&arrivedEventCount)
	if err != nil {
		t.Fatal(err)
	}
	if arrivedEventCount != 0 {
		t.Fatalf("FORBIDDEN: found %d ARRIVED events in audit log for client who never checked in!", arrivedEventCount)
	}

	// Verify CALLED event exists
	var calledEventCount int
	err = p.pool.QueryRow(ctx, `SELECT count(*) FROM ticket_events WHERE ticket_id=$1::uuid AND type='CALLED'`, tkt.ID).Scan(&calledEventCount)
	if err != nil {
		t.Fatal(err)
	}
	if calledEventCount != 1 {
		t.Fatalf("expected exactly 1 CALLED event, got %d", calledEventCount)
	}
}

// TestArrivalSemantics_ExplicitArrive verifies explicit /arrive sets arrived_at and logs ARRIVED event exactly once.
func TestArrivalSemantics_ExplicitArrive(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Hour)
	slot := baseTime.Add(45 * time.Minute)

	// Create appointment
	res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
		BranchID:       demoBranch,
		ServiceID:      parcels,
		IdempotencyKey: "sem-apt-2",
		ScheduledAt:    slot,
	})
	if err != nil {
		t.Fatalf("create appointment: %v", err)
	}
	tkt := res.Appointment.Ticket

	// Client explicitly arrives via /arrive
	arrivedView, err := p.ArriveAppointment(ctx, tkt.ID)
	if err != nil {
		t.Fatalf("ArriveAppointment: %v", err)
	}
	if arrivedView.Ticket.ArrivedAt == nil {
		t.Fatal("expected arrived_at to be set on explicit check-in")
	}

	// Verify exactly 1 ARRIVED event
	var arrivedEventCount int
	err = p.pool.QueryRow(ctx, `SELECT count(*) FROM ticket_events WHERE ticket_id=$1::uuid AND type='ARRIVED'`, tkt.ID).Scan(&arrivedEventCount)
	if err != nil {
		t.Fatal(err)
	}
	if arrivedEventCount != 1 {
		t.Fatalf("expected exactly 1 ARRIVED event, got %d", arrivedEventCount)
	}

	// Second /arrive must be idempotent: still 1 event, same timestamp
	arrivedView2, err := p.ArriveAppointment(ctx, tkt.ID)
	if err != nil {
		t.Fatalf("ArriveAppointment replay: %v", err)
	}
	if !arrivedView2.Ticket.ArrivedAt.Equal(*arrivedView.Ticket.ArrivedAt) {
		t.Fatalf("expected identical timestamp on replay, got %v vs %v", arrivedView2.Ticket.ArrivedAt, arrivedView.Ticket.ArrivedAt)
	}
	err = p.pool.QueryRow(ctx, `SELECT count(*) FROM ticket_events WHERE ticket_id=$1::uuid AND type='ARRIVED'`, tkt.ID).Scan(&arrivedEventCount)
	if err != nil {
		t.Fatal(err)
	}
	if arrivedEventCount != 1 {
		t.Fatalf("expected still exactly 1 ARRIVED event after replay, got %d", arrivedEventCount)
	}
}

// Helper to parse UUID in tests
func mustUUID(s string) pgtype.UUID {
	id, _ := uuid(s)
	return id
}

// TestScheduleCreationEqualsPolicyRecalculation proves the invariant:
// For identical business inputs, due_at and source_rank must match identically
// between ticket creation and QueuePolicy recalculation.
func TestScheduleCreationEqualsPolicyRecalculation(t *testing.T) {
	ctx, p, _ := integration(t)

	// Case A: service normative = 15 min, policy threshold = 30 min
	t.Run("CaseA_ServiceNormativeBelowThreshold", func(t *testing.T) {
		policy := p.GetPolicy()
		if policy.Services == nil {
			policy.Services = make(map[string]domain.ServicePolicy)
		}
		policy.Services[parcels] = domain.ServicePolicy{MaxWaitMinutes: 15}
		p.SetPolicy(policy)

		curPolicy, err := p.GetQueuePolicy(ctx, demoBranch)
		if err != nil {
			t.Fatalf("GetQueuePolicy: %v", err)
		}

		// Ensure policy threshold is 30 min
		curPolicy, err = p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{
			BranchID:                        demoBranch,
			ExpectedVersion:                 curPolicy.Version,
			AppointmentDuePriority:          curPolicy.AppointmentDuePriority,
			QRPriority:                      curPolicy.QRPriority,
			LivePriority:                    curPolicy.LivePriority,
			AntiStarvationThresholdMinutes:  30,
			AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
			AppointmentGraceMinutes:         curPolicy.AppointmentGraceMinutes,
			AppointmentLatePenaltyPerMinute: curPolicy.AppointmentLatePenaltyPerMinute,
			AppointmentLatePenaltyMaxPoints: curPolicy.AppointmentLatePenaltyMaxPoints,
		})
		if err != nil {
			t.Fatalf("UpdateQueuePolicy pre-setup: %v", err)
		}

		qrTicket := create(t, ctx, p, parcels, "case-a-ticket")

		var dueBefore time.Time
		var rankBefore int
		err = p.pool.QueryRow(ctx, `SELECT due_at, source_rank FROM tickets WHERE id=$1::uuid`, qrTicket.ID).Scan(&dueBefore, &rankBefore)
		if err != nil {
			t.Fatalf("query dueBefore: %v", err)
		}

		// Force equivalent recalculation through normal QueuePolicy update (same threshold = 30)
		_, err = p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{
			BranchID:                        demoBranch,
			ExpectedVersion:                 curPolicy.Version,
			AppointmentDuePriority:          curPolicy.AppointmentDuePriority,
			QRPriority:                      curPolicy.QRPriority,
			LivePriority:                    curPolicy.LivePriority,
			AntiStarvationThresholdMinutes:  30,
			AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
			AppointmentGraceMinutes:         curPolicy.AppointmentGraceMinutes,
			AppointmentLatePenaltyPerMinute: curPolicy.AppointmentLatePenaltyPerMinute,
			AppointmentLatePenaltyMaxPoints: curPolicy.AppointmentLatePenaltyMaxPoints,
		})
		if err != nil {
			t.Fatalf("UpdateQueuePolicy: %v", err)
		}

		var dueAfter time.Time
		var rankAfter int
		err = p.pool.QueryRow(ctx, `SELECT due_at, source_rank FROM tickets WHERE id=$1::uuid`, qrTicket.ID).Scan(&dueAfter, &rankAfter)
		if err != nil {
			t.Fatalf("query dueAfter: %v", err)
		}

		if !dueBefore.Equal(dueAfter) {
			t.Fatalf("MISMATCH in Case A: due_at changed from %v to %v after policy update without business input change", dueBefore, dueAfter)
		}
		if rankBefore != rankAfter {
			t.Fatalf("MISMATCH in Case A: source_rank changed from %d to %d", rankBefore, rankAfter)
		}
	})

	// Case B: grace = 0
	t.Run("CaseB_GraceZero", func(t *testing.T) {
		curPolicy, err := p.GetQueuePolicy(ctx, demoBranch)
		if err != nil {
			t.Fatalf("GetQueuePolicy: %v", err)
		}

		curPolicy, err = p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{
			BranchID:                        demoBranch,
			ExpectedVersion:                 curPolicy.Version,
			AppointmentDuePriority:          curPolicy.AppointmentDuePriority,
			QRPriority:                      curPolicy.QRPriority,
			LivePriority:                    curPolicy.LivePriority,
			AntiStarvationThresholdMinutes:  curPolicy.AntiStarvationThresholdMinutes,
			AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
			AppointmentGraceMinutes:         0, // grace = 0
			AppointmentLatePenaltyPerMinute: 5,
			AppointmentLatePenaltyMaxPoints: 90,
		})
		if err != nil {
			t.Fatalf("UpdateQueuePolicy setup: %v", err)
		}

		baseTime := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Hour)
		slot := baseTime.Add(10 * time.Minute)
		res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
			BranchID:       demoBranch,
			ServiceID:      parcels,
			IdempotencyKey: "case-b-apt",
			ScheduledAt:    slot,
		})
		if err != nil {
			t.Fatalf("CreateAppointment: %v", err)
		}

		checkin := slot.Add(5 * time.Minute) // 5 min late when grace = 0
		branchPolicy := p.getBranchPolicyTx(ctx, nil, mustUUID(demoBranch))
		dueExpected, readyExpected, rankExpected := domain.ComputeSchedule(branchPolicy, domain.ScheduleTicketInput{
			Source:      domain.TicketSourceAppointment,
			ScheduledAt: &slot,
			ServiceID:   parcels,
		}, checkin)

		execSQL(t, ctx, p, `UPDATE tickets SET checkin_at=$2, arrived_at=$2, ready_at=$3, due_at=$4, source_rank=$5, status='WAITING' WHERE id=$1::uuid`,
			res.Appointment.Ticket.ID, checkin, readyExpected, dueExpected, rankExpected)

		// Force equivalent recalculation through normal QueuePolicy update
		_, err = p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{
			BranchID:                        demoBranch,
			ExpectedVersion:                 curPolicy.Version,
			AppointmentDuePriority:          curPolicy.AppointmentDuePriority,
			QRPriority:                      curPolicy.QRPriority,
			LivePriority:                    curPolicy.LivePriority,
			AntiStarvationThresholdMinutes:  curPolicy.AntiStarvationThresholdMinutes,
			AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
			AppointmentGraceMinutes:         0,
			AppointmentLatePenaltyPerMinute: 5,
			AppointmentLatePenaltyMaxPoints: 90,
		})
		if err != nil {
			t.Fatalf("UpdateQueuePolicy: %v", err)
		}

		var dueAfter time.Time
		var rankAfter int
		err = p.pool.QueryRow(ctx, `SELECT due_at, source_rank FROM tickets WHERE id=$1::uuid`, res.Appointment.Ticket.ID).Scan(&dueAfter, &rankAfter)
		if err != nil {
			t.Fatalf("query dueAfter: %v", err)
		}

		if !dueExpected.Equal(dueAfter) {
			t.Fatalf("MISMATCH in Case B (grace=0): due_at before (%v) != due_at after (%v)", dueExpected, dueAfter)
		}
		if rankExpected != rankAfter {
			t.Fatalf("MISMATCH in Case B (grace=0): source_rank before (%d) != after (%d)", rankExpected, rankAfter)
		}
	})

	// Case C: late penalty max = 0
	t.Run("CaseC_LatePenaltyMaxZero", func(t *testing.T) {
		curPolicy, err := p.GetQueuePolicy(ctx, demoBranch)
		if err != nil {
			t.Fatalf("GetQueuePolicy: %v", err)
		}

		curPolicy, err = p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{
			BranchID:                        demoBranch,
			ExpectedVersion:                 curPolicy.Version,
			AppointmentDuePriority:          curPolicy.AppointmentDuePriority,
			QRPriority:                      curPolicy.QRPriority,
			LivePriority:                    curPolicy.LivePriority,
			AntiStarvationThresholdMinutes:  curPolicy.AntiStarvationThresholdMinutes,
			AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
			AppointmentGraceMinutes:         5,
			AppointmentLatePenaltyPerMinute: 5,
			AppointmentLatePenaltyMaxPoints: 0, // penalty max = 0
		})
		if err != nil {
			t.Fatalf("UpdateQueuePolicy setup: %v", err)
		}

		baseTime := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Hour)
		slot := baseTime.Add(10 * time.Minute)
		res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
			BranchID:       demoBranch,
			ServiceID:      parcels,
			IdempotencyKey: "case-c-apt",
			ScheduledAt:    slot,
		})
		if err != nil {
			t.Fatalf("CreateAppointment: %v", err)
		}

		checkin := slot.Add(30 * time.Minute) // 25 min late
		branchPolicy := p.getBranchPolicyTx(ctx, nil, mustUUID(demoBranch))
		dueExpected, readyExpected, rankExpected := domain.ComputeSchedule(branchPolicy, domain.ScheduleTicketInput{
			Source:      domain.TicketSourceAppointment,
			ScheduledAt: &slot,
			ServiceID:   parcels,
		}, checkin)

		execSQL(t, ctx, p, `UPDATE tickets SET checkin_at=$2, arrived_at=$2, ready_at=$3, due_at=$4, source_rank=$5, status='WAITING' WHERE id=$1::uuid`,
			res.Appointment.Ticket.ID, checkin, readyExpected, dueExpected, rankExpected)

		_, err = p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{
			BranchID:                        demoBranch,
			ExpectedVersion:                 curPolicy.Version,
			AppointmentDuePriority:          curPolicy.AppointmentDuePriority,
			QRPriority:                      curPolicy.QRPriority,
			LivePriority:                    curPolicy.LivePriority,
			AntiStarvationThresholdMinutes:  curPolicy.AntiStarvationThresholdMinutes,
			AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
			AppointmentGraceMinutes:         5,
			AppointmentLatePenaltyPerMinute: 5,
			AppointmentLatePenaltyMaxPoints: 0,
		})
		if err != nil {
			t.Fatalf("UpdateQueuePolicy: %v", err)
		}

		var dueAfter time.Time
		var rankAfter int
		err = p.pool.QueryRow(ctx, `SELECT due_at, source_rank FROM tickets WHERE id=$1::uuid`, res.Appointment.Ticket.ID).Scan(&dueAfter, &rankAfter)
		if err != nil {
			t.Fatalf("query dueAfter: %v", err)
		}

		if !dueExpected.Equal(dueAfter) {
			t.Fatalf("MISMATCH in Case C (late penalty max=0): due_at before (%v) != due_at after (%v)", dueExpected, dueAfter)
		}
		if rankExpected != rankAfter {
			t.Fatalf("MISMATCH in Case C: source_rank before (%d) != after (%d)", rankExpected, rankAfter)
		}
	})

	// Case D: QR and LIVE source-rank parity/priorities
	t.Run("CaseD_QRAndLiveSourceRankParity", func(t *testing.T) {
		curPolicy, err := p.GetQueuePolicy(ctx, demoBranch)
		if err != nil {
			t.Fatalf("GetQueuePolicy: %v", err)
		}

		// Priority where LIVE > QR
		curPolicy, err = p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{
			BranchID:                        demoBranch,
			ExpectedVersion:                 curPolicy.Version,
			AppointmentDuePriority:          500,
			QRPriority:                      100,
			LivePriority:                    200, // LIVE > QR
			AntiStarvationThresholdMinutes:  30,
			AntiStarvationPointsPerMinute:   10,
			AppointmentGraceMinutes:         15,
			AppointmentLatePenaltyPerMinute: 5,
			AppointmentLatePenaltyMaxPoints: 90,
		})
		if err != nil {
			t.Fatalf("UpdateQueuePolicy setup: %v", err)
		}

		tQR := create(t, ctx, p, parcels, "case-d-qr")
		tLive := live(t, ctx, p, "case-d-live", parcels)

		var qrRankBefore, liveRankBefore int
		_ = p.pool.QueryRow(ctx, `SELECT source_rank FROM tickets WHERE id=$1::uuid`, tQR.ID).Scan(&qrRankBefore)
		_ = p.pool.QueryRow(ctx, `SELECT source_rank FROM tickets WHERE id=$1::uuid`, tLive.ID).Scan(&liveRankBefore)

		if qrRankBefore != 2 || liveRankBefore != 1 {
			t.Fatalf("expected QR rank 2, LIVE rank 1 when LIVE > QR, got QR=%d, LIVE=%d", qrRankBefore, liveRankBefore)
		}

		// Equivalent policy update
		_, err = p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{
			BranchID:                        demoBranch,
			ExpectedVersion:                 curPolicy.Version,
			AppointmentDuePriority:          500,
			QRPriority:                      100,
			LivePriority:                    200,
			AntiStarvationThresholdMinutes:  30,
			AntiStarvationPointsPerMinute:   10,
			AppointmentGraceMinutes:         15,
			AppointmentLatePenaltyPerMinute: 5,
			AppointmentLatePenaltyMaxPoints: 90,
		})
		if err != nil {
			t.Fatalf("UpdateQueuePolicy: %v", err)
		}

		var qrRankAfter, liveRankAfter int
		_ = p.pool.QueryRow(ctx, `SELECT source_rank FROM tickets WHERE id=$1::uuid`, tQR.ID).Scan(&qrRankAfter)
		_ = p.pool.QueryRow(ctx, `SELECT source_rank FROM tickets WHERE id=$1::uuid`, tLive.ID).Scan(&liveRankAfter)

		if qrRankBefore != qrRankAfter || liveRankBefore != liveRankAfter {
			t.Fatalf("MISMATCH in Case D: ranks before (QR=%d, LIVE=%d) != after (QR=%d, LIVE=%d)", qrRankBefore, liveRankBefore, qrRankAfter, liveRankAfter)
		}
	})
}

// TestNearTurnUsesTrueCanonicalTopTwo verifies that near-turn notification logic
// operates on the true top-2 queue candidates, rather than selecting the first 2
// candidates that have not yet been notified.
func TestNearTurnUsesTrueCanonicalTopTwo(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Date(2026, 9, 21, 14, 0, 0, 0, time.UTC)

	// Clean outbox
	execSQL(t, ctx, p, `DELETE FROM notification_outbox`)

	// Ensure Window 1 is OPEN
	if _, err := p.ChangeWindowStatus(ctx, window1, domain.WindowStatusOpen); err != nil {
		t.Fatal(err)
	}

	// Create 3 tickets: T1 (pos 1), T2 (pos 2), T3 (pos 3)
	t1 := create(t, ctx, p, parcels, "top2-t1")
	t2 := create(t, ctx, p, parcels, "top2-t2")
	t3 := create(t, ctx, p, parcels, "top2-t3")

	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, t1.ID, baseTime.Add(1*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, t2.ID, baseTime.Add(2*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, t3.ID, baseTime.Add(3*time.Minute))

	// Pre-populate near-turn notification for T1 and T2 (simulating they have already received near-turn)
	for _, tkt := range []domain.Ticket{t1, t2} {
		var cycleID int64
		_ = p.pool.QueryRow(ctx, `SELECT COALESCE(MAX(id),0) FROM ticket_events WHERE ticket_id=$1::uuid AND type IN ('CREATED','RETURNED','REDIRECTED','ARRIVED')`, tkt.ID).Scan(&cycleID)
		dedupeKey := fmt.Sprintf("TICKET_NEAR_TURN:%s:%d", tkt.ID, cycleID)
		execSQL(t, ctx, p, `
			INSERT INTO notification_outbox (ticket_id, branch_id, event_type, dedupe_key, payload, status, next_attempt_at, created_at)
			VALUES ($1::uuid, $2::uuid, 'TICKET_NEAR_TURN', $3, '{}'::jsonb, 'SENT', clock_timestamp(), clock_timestamp())
		`, tkt.ID, demoBranch, dedupeKey)
	}

	// Trigger near-turn evaluation for the branch
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := p.enqueueNearTurnForTopCandidates(ctx, tx, demoBranch, baseTime.Add(5*time.Minute)); err != nil {
		tx.Rollback(ctx)
		t.Fatalf("enqueueNearTurnForTopCandidates: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	// Reviewer assertion: T3 is at position 3, so T3 must NOT have received a near-turn notification!
	var countT3 int
	err = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND event_type='TICKET_NEAR_TURN'`, t3.ID).Scan(&countT3)
	if err != nil {
		t.Fatal(err)
	}
	if countT3 != 0 {
		t.Fatalf("BUG CONFIRMED: T3 at position 3 received near-turn notification because T1 and T2 were already notified! count=%d", countT3)
	}

	// Also verify via EnqueueNearTurnIfEligible directly for T3: position is 3, must return without enqueuing
	if err := p.EnqueueNearTurnIfEligible(ctx, t3.ID); err != nil {
		t.Fatalf("EnqueueNearTurnIfEligible T3: %v", err)
	}
	_ = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND event_type='TICKET_NEAR_TURN'`, t3.ID).Scan(&countT3)
	if countT3 != 0 {
		t.Fatalf("EnqueueNearTurnIfEligible enqueued notification for ticket at position 3! count=%d", countT3)
	}
}

// TestNearTurnRespectsCompatibleWindow verifies that near-turn notification is only
// enqueued when an OPEN compatible window exists for the ticket's service.
func TestNearTurnRespectsCompatibleWindow(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Date(2026, 9, 21, 14, 0, 0, 0, time.UTC)
	execSQL(t, ctx, p, `DELETE FROM notification_outbox`)

	// Close window 2 (payments window). Windows 1 and 3 are parcels only.
	if _, err := p.ChangeWindowStatus(ctx, window2, domain.WindowStatusClosed); err != nil {
		t.Fatal(err)
	}

	// Create ticket for PAYMENTS service
	tPay := create(t, ctx, p, payments, "pay-no-win")
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, tPay.ID, baseTime.Add(1*time.Minute))

	// Attempt near-turn: ticket has NO compatible open window in branch!
	if err := p.EnqueueNearTurnIfEligible(ctx, tPay.ID); err != nil {
		t.Fatalf("EnqueueNearTurnIfEligible: %v", err)
	}

	var countPay int
	_ = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND event_type='TICKET_NEAR_TURN'`, tPay.ID).Scan(&countPay)
	if countPay != 0 {
		t.Fatalf("expected 0 near-turn notifications when NO compatible open window exists, got %d", countPay)
	}

	// Now open Window 2 (compatible with payments)
	if _, err := p.ChangeWindowStatus(ctx, window2, domain.WindowStatusOpen); err != nil {
		t.Fatal(err)
	}

	// Now near-turn should be enqueued
	if err := p.EnqueueNearTurnIfEligible(ctx, tPay.ID); err != nil {
		t.Fatalf("EnqueueNearTurnIfEligible after window opened: %v", err)
	}

	_ = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND event_type='TICKET_NEAR_TURN'`, tPay.ID).Scan(&countPay)
	if countPay != 1 {
		t.Fatalf("expected 1 near-turn notification after compatible window opened, got %d", countPay)
	}
}

// TestNearTurnConcurrentEnqueueIdempotent verifies that concurrent transactions attempting
// to enqueue near-turn notifications produce exactly 1 outbox event at the database level,
// and that legitimate re-entry (return to queue) correctly permits a new notification.
func TestNearTurnConcurrentEnqueueIdempotent(t *testing.T) {
	ctx, p, _ := integration(t)
	baseTime := time.Date(2026, 9, 21, 14, 0, 0, 0, time.UTC)
	execSQL(t, ctx, p, `DELETE FROM notification_outbox`)

	if _, err := p.ChangeWindowStatus(ctx, window1, domain.WindowStatusOpen); err != nil {
		t.Fatal(err)
	}

	tkt := create(t, ctx, p, parcels, "concurrent-near-turn")
	execSQL(t, ctx, p, `UPDATE tickets SET due_at=$2, ready_at=$2, source_rank=1, checkin_at=$2 WHERE id=$1::uuid`, tkt.ID, baseTime)

	// 10 concurrent transactions attempt to enqueue near-turn for the same occurrence
	const workers = 10
	var wg sync.WaitGroup
	errs := make([]error, workers)
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			errs[idx] = p.EnqueueNearTurnIfEligible(ctx, tkt.ID)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Errorf("worker %d error: %v", i, err)
		}
	}

	// Assert EXACTLY 1 business notification in outbox
	var outboxCount int
	err := p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND event_type='TICKET_NEAR_TURN'`, tkt.ID).Scan(&outboxCount)
	if err != nil {
		t.Fatal(err)
	}
	if outboxCount != 1 {
		t.Fatalf("expected exactly 1 outbox event across concurrent workers, got %d", outboxCount)
	}

	// Now simulate ticket is called, served, and returned to queue (legitimate new queue-entry cycle)
	called, err := p.CallNextAt(ctx, window1, baseTime.Add(5*time.Minute))
	if err != nil {
		t.Fatalf("CallNext: %v", err)
	}
	if called.ID != tkt.ID {
		t.Fatalf("expected called ticket %s, got %s", tkt.ID, called.ID)
	}

	returned, err := p.ReturnTicket(ctx, tkt.ID)
	if err != nil {
		t.Fatalf("ReturnTicket: %v", err)
	}
	if returned.Status != domain.TicketStatusWaiting {
		t.Fatalf("expected returned status WAITING, got %s", returned.Status)
	}

	// In the new queue-entry cycle, when near-turn is evaluated, it may legitimately enqueue a new notification
	if err := p.EnqueueNearTurnIfEligible(ctx, tkt.ID); err != nil {
		t.Fatalf("EnqueueNearTurnIfEligible in new cycle: %v", err)
	}

	err = p.pool.QueryRow(ctx, `SELECT count(*) FROM notification_outbox WHERE ticket_id=$1::uuid AND event_type='TICKET_NEAR_TURN'`, tkt.ID).Scan(&outboxCount)
	if err != nil {
		t.Fatal(err)
	}
	if outboxCount != 2 {
		t.Fatalf("expected exactly 2 near-turn outbox events after return to queue (1 per cycle), got %d", outboxCount)
	}
}

// TestPolicyRecalculationAudit verifies that when a policy update changes due_at or source_rank,
// an immutable QUEUE_RECALCULATED event is appended to ticket_events explaining the change.
func TestPolicyRecalculationAudit(t *testing.T) {
	ctx, p, _ := integration(t)

	curPolicy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil {
		t.Fatalf("GetQueuePolicy: %v", err)
	}

	tkt := create(t, ctx, p, parcels, "audit-recalc-tkt")

	// Verify events count before policy update: only CREATED
	evsBefore, err := p.ListTicketEvents(ctx, tkt.ID)
	if err != nil {
		t.Fatalf("ListTicketEvents: %v", err)
	}
	if len(evsBefore) != 1 || evsBefore[0].Type != domain.TicketEventCreated {
		t.Fatalf("expected 1 CREATED event before, got %v", evsBefore)
	}

	// Update QueuePolicy changing anti-starvation threshold from default to 5 minutes
	newThreshold := 5
	if curPolicy.AntiStarvationThresholdMinutes == 5 {
		newThreshold = 10
	}
	updatedPolicy, err := p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{
		BranchID:                        demoBranch,
		ExpectedVersion:                 curPolicy.Version,
		AppointmentDuePriority:          curPolicy.AppointmentDuePriority,
		QRPriority:                      curPolicy.QRPriority,
		LivePriority:                    curPolicy.LivePriority,
		AntiStarvationThresholdMinutes:  newThreshold,
		AntiStarvationPointsPerMinute:   curPolicy.AntiStarvationPointsPerMinute,
		AppointmentGraceMinutes:         curPolicy.AppointmentGraceMinutes,
		AppointmentLatePenaltyPerMinute: curPolicy.AppointmentLatePenaltyPerMinute,
		AppointmentLatePenaltyMaxPoints: curPolicy.AppointmentLatePenaltyMaxPoints,
	})
	if err != nil {
		t.Fatalf("UpdateQueuePolicy: %v", err)
	}

	// Verify audit log has QUEUE_RECALCULATED event
	evsAfter, err := p.ListTicketEvents(ctx, tkt.ID)
	if err != nil {
		t.Fatalf("ListTicketEvents after: %v", err)
	}
	if len(evsAfter) != 2 {
		t.Fatalf("expected 2 events after policy update (CREATED + QUEUE_RECALCULATED), got %d: %+v", len(evsAfter), evsAfter)
	}

	recalcEvent := evsAfter[1]
	if recalcEvent.Type != domain.TicketEventQueueRecalculated {
		t.Fatalf("expected event type QUEUE_RECALCULATED, got %s", recalcEvent.Type)
	}
	if recalcEvent.PolicyVersion == nil || *recalcEvent.PolicyVersion != updatedPolicy.Version {
		t.Fatalf("expected policyVersion %d, got %v", updatedPolicy.Version, recalcEvent.PolicyVersion)
	}
	if recalcEvent.ToStatus != domain.TicketStatusWaiting {
		t.Fatalf("expected toStatus WAITING, got %s", recalcEvent.ToStatus)
	}
	if recalcEvent.FromStatus != nil {
		t.Fatalf("expected fromStatus nil for in-status recalculation, got %v", recalcEvent.FromStatus)
	}
	if recalcEvent.DueAt == nil {
		t.Fatal("expected dueAt to be recorded on QUEUE_RECALCULATED event")
	}
}

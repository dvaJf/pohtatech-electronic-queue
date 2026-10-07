package persistence

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"postcode/backend/internal/domain"
)

func setBranchTierPolicy(t *testing.T, ctx context.Context, p *Postgres, branchID string, promotionInterval, grace int) {
	t.Helper()
	curPolicy, err := p.GetQueuePolicy(ctx, branchID)
	if err != nil {
		t.Fatalf("GetQueuePolicy: %v", err)
	}
	execSQL(t, ctx, p, `UPDATE queue_policies SET anti_starvation_threshold_minutes=$2, appointment_grace_minutes=$3, scheduled_effective_date=NULL WHERE branch_id=$1::uuid`,
		branchID, promotionInterval, grace)
	_ = curPolicy
}

func TestQueuePriorityMixedChannelTransitions(t *testing.T) {
	ctx, p, _ := integration(t)
	base := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	setBranchTierPolicy(t, ctx, p, demoBranch, 10, 5) // T=10m, Grace=5m

	slot := base.Add(15 * time.Minute) // 10:15
	apt := book(t, ctx, p, "apt-mix", parcels).Appointment.Ticket
	execSQL(t, ctx, p, `UPDATE tickets SET scheduled_at=$2, queue_entered_at=$2, ready_at=$2, created_at=$3 WHERE id=$1::uuid`,
		apt.ID, slot, base)

	// Decision at 10:14 - appointment is ineligible before slot
	_, err := p.CallNextAt(ctx, window1, base.Add(14*time.Minute))
	if err == nil {
		t.Fatalf("expected error (ineligible) for appointment before slot, got called")
	}

	// Create QR at 10:00 (promotes to Tier 0 at 10:10) and LIVE at 10:00 (promotes to Tier 1 at 10:10, Tier 0 at 10:20)
	tQR := create(t, ctx, p, parcels, "qr-mix")
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=$2, checkin_at=$2, ready_at=$2, created_at=$2 WHERE id=$1::uuid`,
		tQR.ID, base)

	tLive := live(t, ctx, p, "live-mix", parcels)
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=$2, checkin_at=$2, ready_at=$2, created_at=$2 WHERE id=$1::uuid`,
		tLive.ID, base)

	// At 10:05:
	// Apt: ineligible (slot 10:15)
	// QR: Tier 1 (QR) entered at 10:00
	// LIVE: Tier 2 (LIVE) entered at 10:00
	// CallNext should call QR (Tier 1 < Tier 2)
	called, err := p.CallNextAt(ctx, window1, base.Add(5*time.Minute))
	if err != nil {
		t.Fatalf("CallNextAt 10:05 failed: %v", err)
	}
	if called.ID != tQR.ID {
		t.Fatalf("at 10:05 expected QR ticket %s, got %s (source=%s)", tQR.ID, called.ID, called.Source)
	}
}

func TestQueuePrioritySameSlotAppointmentsCreationOrder(t *testing.T) {
	ctx, p, _ := integration(t)
	base := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	setBranchTierPolicy(t, ctx, p, demoBranch, 10, 5)

	slot := base.Add(15 * time.Minute) // 10:15
	a1 := book(t, ctx, p, "slot-a1", parcels).Appointment.Ticket
	a2 := book(t, ctx, p, "slot-a2", parcels).Appointment.Ticket
	a3 := book(t, ctx, p, "slot-a3", parcels).Appointment.Ticket

	// Set same slot, but different created_at: a1 @ 09:00, a2 @ 09:05, a3 @ 09:10
	execSQL(t, ctx, p, `UPDATE tickets SET scheduled_at=$2, queue_entered_at=$2, ready_at=$2, created_at=$3 WHERE id=$1::uuid`,
		a1.ID, slot, base.Add(-60*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET scheduled_at=$2, queue_entered_at=$2, ready_at=$2, created_at=$3 WHERE id=$1::uuid`,
		a2.ID, slot, base.Add(-55*time.Minute))
	execSQL(t, ctx, p, `UPDATE tickets SET scheduled_at=$2, queue_entered_at=$2, ready_at=$2, created_at=$3 WHERE id=$1::uuid`,
		a3.ID, slot, base.Add(-50*time.Minute))

	// At 10:15, all 3 are Tier 0, entered at 10:15.
	// CallNext should return them in created_at order: a1, then a2, then a3.
	call1, err := p.CallNextAt(ctx, window1, slot)
	if err != nil || call1.ID != a1.ID {
		t.Fatalf("expected call1=a1 (%s), got %s, err: %v", a1.ID, call1.ID, err)
	}
	_, _ = p.StartService(ctx, call1.ID)
	_, _ = p.CompleteService(ctx, call1.ID)

	call2, err := p.CallNextAt(ctx, window1, slot)
	if err != nil || call2.ID != a2.ID {
		t.Fatalf("expected call2=a2 (%s), got %s, err: %v", a2.ID, call2.ID, err)
	}
	_, _ = p.StartService(ctx, call2.ID)
	_, _ = p.CompleteService(ctx, call2.ID)

	call3, err := p.CallNextAt(ctx, window1, slot)
	if err != nil || call3.ID != a3.ID {
		t.Fatalf("expected call3=a3 (%s), got %s, err: %v", a3.ID, call3.ID, err)
	}
}

func TestQueuePriorityQRPromotedBeforeLaterAppointment(t *testing.T) {
	ctx, p, _ := integration(t)
	base := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	setBranchTierPolicy(t, ctx, p, demoBranch, 10, 5) // T=10m

	// QR created at 10:00 -> promoted to Tier 0 at 10:10 (tier_entered_at = 10:10)
	tQR := create(t, ctx, p, parcels, "prio-qr")
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=$2, checkin_at=$2, ready_at=$2, created_at=$2 WHERE id=$1::uuid`,
		tQR.ID, base)

	// Appointment slot at 10:15 -> enters Tier 0 at 10:15 (tier_entered_at = 10:15)
	slot := base.Add(15 * time.Minute)
	apt := book(t, ctx, p, "prio-apt", parcels).Appointment.Ticket
	execSQL(t, ctx, p, `UPDATE tickets SET scheduled_at=$2, queue_entered_at=$2, ready_at=$2, created_at=$3 WHERE id=$1::uuid`,
		apt.ID, slot, base.Add(-30*time.Minute))

	// At 10:15:
	// Both are Tier 0.
	// QR entered Tier 0 at 10:10.
	// Appointment entered Tier 0 at 10:15.
	// QR must be called FIRST!
	first, err := p.CallNextAt(ctx, window1, slot)
	if err != nil {
		t.Fatalf("CallNextAt failed: %v", err)
	}
	if first.ID != tQR.ID {
		t.Fatalf("expected QR ticket %s to be called first before later appointment %s, got %s",
			tQR.ID, apt.ID, first.ID)
	}
}

func TestQueuePriorityLivePromotedTwice(t *testing.T) {
	ctx, p, _ := integration(t)
	base := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	setBranchTierPolicy(t, ctx, p, demoBranch, 10, 5) // T=10m

	// LIVE entered at 10:00 -> Tier 1 at 10:10, Tier 0 at 10:20 (tier_entered_at = 10:20)
	tLive := live(t, ctx, p, "prio-live-2x", parcels)
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=$2, checkin_at=$2, ready_at=$2, created_at=$2 WHERE id=$1::uuid`,
		tLive.ID, base)

	// Appointment slot at 10:25 -> enters Tier 0 at 10:25 (tier_entered_at = 10:25)
	slot := base.Add(25 * time.Minute)
	apt := book(t, ctx, p, "prio-apt-25", parcels).Appointment.Ticket
	execSQL(t, ctx, p, `UPDATE tickets SET scheduled_at=$2, queue_entered_at=$2, ready_at=$2, created_at=$3 WHERE id=$1::uuid`,
		apt.ID, slot, base.Add(-20*time.Minute))

	// At 10:25: Both are Tier 0. LIVE entered at 10:20 < Appointment entered at 10:25.
	// LIVE must be called FIRST!
	first, err := p.CallNextAt(ctx, window1, slot)
	if err != nil {
		t.Fatalf("CallNextAt failed: %v", err)
	}
	if first.ID != tLive.ID {
		t.Fatalf("expected LIVE ticket %s to be called first (promoted twice), got %s", tLive.ID, first.ID)
	}
}

func TestQueuePriorityTieBreakUUID(t *testing.T) {
	ctx, p, _ := integration(t)
	base := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	setBranchTierPolicy(t, ctx, p, demoBranch, 10, 5)

	t1 := create(t, ctx, p, parcels, "uuid-1")
	t2 := create(t, ctx, p, parcels, "uuid-2")

	// Set exact identical tier, tier_entered_at, created_at
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=$2, checkin_at=$2, ready_at=$2, created_at=$2 WHERE id=$1::uuid`,
		t1.ID, base)
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=$2, checkin_at=$2, ready_at=$2, created_at=$2 WHERE id=$1::uuid`,
		t2.ID, base)

	expectedFirst := t1.ID
	expectedSecond := t2.ID
	if t2.ID < t1.ID {
		expectedFirst = t2.ID
		expectedSecond = t1.ID
	}

	call1, err := p.CallNextAt(ctx, window1, base)
	if err != nil || call1.ID != expectedFirst {
		t.Fatalf("expected smaller UUID %s, got %s, err: %v", expectedFirst, call1.ID, err)
	}
	_, _ = p.StartService(ctx, call1.ID)
	_, _ = p.CompleteService(ctx, call1.ID)

	call2, err := p.CallNextAt(ctx, window1, base)
	if err != nil || call2.ID != expectedSecond {
		t.Fatalf("expected second UUID %s, got %s, err: %v", expectedSecond, call2.ID, err)
	}
}

func TestQueuePriorityServiceFiltering(t *testing.T) {
	ctx, p, _ := integration(t)
	base := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	setBranchTierPolicy(t, ctx, p, demoBranch, 10, 5)

	// Window1 serves 'parcels', but ticket is created for 'payments'
	tPay := create(t, ctx, p, payments, "svc-filter-pay")
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=$2, checkin_at=$2, ready_at=$2, created_at=$2 WHERE id=$1::uuid`,
		tPay.ID, base)

	_, err := p.CallNextAt(ctx, window1, base)
	if err == nil {
		t.Fatalf("expected error since window1 cannot serve payments, but ticket was called")
	}
}

func TestQueuePriorityTwoWindowConcurrency(t *testing.T) {
	ctx, p, _ := integration(t)
	base := time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC)
	setBranchTierPolicy(t, ctx, p, demoBranch, 10, 5)

	// Open window3 as well
	_, err := p.ChangeWindowStatus(ctx, window3, domain.WindowStatusOpen)
	if err != nil {
		t.Fatalf("ChangeWindowStatus window3: %v", err)
	}

	// Create 10 tickets
	for i := 0; i < 10; i++ {
		tkt := create(t, ctx, p, parcels, fmt.Sprintf("conc-%d", i))
		execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=$2, checkin_at=$2, ready_at=$2, created_at=$2 WHERE id=$1::uuid`,
			tkt.ID, base.Add(time.Duration(i)*time.Second))
	}

	var wg sync.WaitGroup
	var t1Result, t2Result domain.Ticket
	var t1Err, t2Err error

	wg.Add(2)
	go func() {
		defer wg.Done()
		t1Result, t1Err = p.CallNextAt(ctx, window1, base.Add(1*time.Minute))
	}()
	go func() {
		defer wg.Done()
		t2Result, t2Err = p.CallNextAt(ctx, window3, base.Add(1*time.Minute))
	}()
	wg.Wait()

	if t1Err != nil {
		t.Fatalf("window1 CallNext error: %v", t1Err)
	}
	if t2Err != nil {
		t.Fatalf("window3 CallNext error: %v", t2Err)
	}
	if t1Result.ID == t2Result.ID {
		t.Fatalf("two windows called the SAME ticket: %s", t1Result.ID)
	}
}

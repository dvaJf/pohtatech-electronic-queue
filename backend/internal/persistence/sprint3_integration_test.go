package persistence

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func live(t *testing.T, ctx context.Context, p *Postgres, key, service string) domain.Ticket {
	t.Helper()
	r, err := p.CreateLiveTicket(ctx, application.CreateLiveTicketCommand{BranchID: demoBranch, ServiceID: service, IdempotencyKey: key})
	if err != nil || r.Replayed {
		t.Fatalf("live=%+v %v", r, err)
	}
	return r.Ticket
}
func policyCommand(p domain.QueuePolicy) application.UpdateQueuePolicyCommand {
	return application.UpdateQueuePolicyCommand{BranchID: p.BranchID, AppointmentDuePriority: p.AppointmentDuePriority, QRPriority: p.QRPriority, LivePriority: p.LivePriority,
		AntiStarvationThresholdMinutes: p.AntiStarvationThresholdMinutes, AntiStarvationPointsPerMinute: p.AntiStarvationPointsPerMinute,
		AppointmentGraceMinutes: p.AppointmentGraceMinutes, AppointmentLatePenaltyPerMinute: p.AppointmentLatePenaltyPerMinute,
		AppointmentLatePenaltyMaxPoints: p.AppointmentLatePenaltyMaxPoints, ExpectedVersion: p.Version}
}
func TestSprint3LiveIdempotency(t *testing.T) {
	ctx, p, _ := integration(t)
	cmd := application.CreateLiveTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "live-race"}
	var results [16]application.CreateLiveTicketResult
	var errs [16]error
	concurrently(len(results), func(i int) { results[i], errs[i] = p.CreateLiveTicket(ctx, cmd) })
	created := 0
	for i, r := range results {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if !r.Replayed {
			created++
		}
		if r.Ticket.ID != results[0].Ticket.ID || r.Ticket.PublicNumber != "L-000001" || r.Ticket.Window != nil || !r.Ticket.CreatedAt.Equal(r.Ticket.QueueEnteredAt) {
			t.Fatalf("live=%+v", r)
		}
	}
	if created != 1 {
		t.Fatal(created)
	}
	ticket := results[0].Ticket
	ev := events(t, ctx, p, ticket.ID, 1)[0]
	if ev.Type != domain.TicketEventCreated || !ev.OccurredAt.Equal(ticket.CreatedAt) {
		t.Fatal(ev)
	}
	var allocated int
	if err := p.pool.QueryRow(ctx, `SELECT last_value FROM live_public_number_seq`).Scan(&allocated); err != nil || allocated != 1 {
		t.Fatalf("allocated=%d %v", allocated, err)
	}
	for _, c := range []application.CreateLiveTicketCommand{
		{BranchID: missing, ServiceID: parcels, IdempotencyKey: cmd.IdempotencyKey},
		{BranchID: demoBranch, ServiceID: payments, IdempotencyKey: cmd.IdempotencyKey},
	} {
		_, err := p.CreateLiveTicket(ctx, c)
		wantError(t, err, application.ErrIdempotencyConflict)
	}
	_, err := p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: cmd.IdempotencyKey})
	wantError(t, err, application.ErrIdempotencyConflict)
	_, err = p.CreateAppointment(ctx, application.CreateAppointmentCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: cmd.IdempotencyKey, ScheduledAt: time.Now().Add(time.Hour)})
	wantError(t, err, application.ErrIdempotencyConflict)
	create(t, ctx, p, parcels, "qr-first")
	cmd.IdempotencyKey = "qr-first"
	_, err = p.CreateLiveTicket(ctx, cmd)
	wantError(t, err, application.ErrIdempotencyConflict)
	cmd.IdempotencyKey = "missing"
	cmd.ServiceID = missing
	_, err = p.CreateLiveTicket(ctx, cmd)
	wantError(t, err, application.ErrNotFound)
	cmd.ServiceID = parcels
	cmd.IdempotencyKey = " "
	_, err = p.CreateLiveTicket(ctx, cmd)
	wantError(t, err, application.ErrInvalidState)
	// Distinct creates allocate unique L-numbers concurrently.
	concurrently(len(results), func(i int) {
		c := application.CreateLiveTicketCommand{BranchID: demoBranch, ServiceID: payments, IdempotencyKey: fmt.Sprint("distinct", i)}
		results[i], errs[i] = p.CreateLiveTicket(ctx, c)
	})
	numbers := map[string]bool{}
	for i, r := range results {
		if errs[i] != nil || numbers[r.Ticket.PublicNumber] || !strings.HasPrefix(r.Ticket.PublicNumber, "L-") {
			t.Fatalf("distinct=%+v %v", r, errs[i])
		}
		numbers[r.Ticket.PublicNumber] = true
	}
	_, err = p.CallNext(ctx, window1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.MarkNoShow(ctx, ticket.ID)
	if err != nil {
		t.Fatal(err)
	}
	cmd = application.CreateLiveTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "live-race"}
	replay, err := p.CreateLiveTicket(ctx, cmd)
	if err != nil || !replay.Replayed || replay.Ticket.Status != domain.TicketStatusNoShow {
		t.Fatalf("terminal replay=%+v %v", replay, err)
	}
	events(t, ctx, p, ticket.ID, 3)
}

func TestSprint3RankingArithmetic(t *testing.T) {
	ctx, p, _ := integration(t)
	policy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	at := time.Date(2200, 1, 1, 0, 0, 0, 0, time.UTC)
	a := book(t, ctx, p, "ranking", parcels).Appointment.Ticket
	// Golden cases exercise the production SQL primitive, not a Go copy of it.
	cases := []struct {
		name                               string
		source                             string
		wait, late                         int64
		arrival                            bool
		grace, rate, cap, threshold, boost int
		want                               int64
	}{
		{"legacy", "APPOINTMENT", 0, 0, false, 15, 5, 90, 15, 10, 100},
		{"early", "APPOINTMENT", 0, -300, true, 15, 5, 90, 15, 10, 100},
		{"grace boundary", "APPOINTMENT", 0, 900, true, 15, 5, 90, 15, 10, 100},
		{"floor penalty", "APPOINTMENT", 0, 911, true, 15, 5, 90, 15, 10, 100},
		{"first penalty point", "APPOINTMENT", 0, 912, true, 15, 5, 90, 15, 10, 99},
		{"late", "APPOINTMENT", 0, 1020, true, 15, 5, 90, 15, 10, 90},
		{"maximum penalty", "APPOINTMENT", 0, 9000, true, 15, 5, 90, 15, 10, 10},
		{"zero grace", "APPOINTMENT", 0, 60, true, 0, 5, 90, 15, 10, 95},
		{"zero penalty", "APPOINTMENT", 0, 9000, true, 0, 0, 90, 15, 10, 100},
		{"zero cap", "APPOINTMENT", 0, 9000, true, 0, 5, 0, 15, 10, 100},
		{"branch delay", "APPOINTMENT", 1200, 1020, true, 15, 5, 90, 15, 10, 140},
		{"legacy aging", "APPOINTMENT", 1200, 0, false, 15, 5, 90, 15, 10, 150},
		{"QR threshold", "QR", 900, 0, false, 15, 5, 90, 15, 10, 10},
		{"QR floor", "QR", 905, 0, false, 15, 5, 90, 15, 10, 10},
		{"QR first boost", "QR", 906, 0, false, 15, 5, 90, 15, 10, 11},
		{"QR outranks fresh appointment", "QR", 1500, 0, false, 15, 5, 90, 15, 10, 110},
		{"LIVE outranks fresh appointment", "LIVE", 1500, 0, false, 15, 5, 90, 15, 10, 110},
		{"zero threshold", "LIVE", 60, 0, false, 15, 5, 90, 0, 600, 610},
		{"large integer", "QR", 4000000000, 0, false, 15, 5, 90, 0, 600, 40000000010},
		{"negative waiting clamps", "QR", -60, 0, false, 15, 5, 90, 0, 600, 10},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			effective := at.Add(-time.Duration(tc.wait) * time.Second)
			scheduled := effective
			var arrived any
			if tc.arrival {
				if tc.late > 0 {
					scheduled = effective.Add(-time.Duration(tc.late) * time.Second)
				}
				arrived = scheduled.Add(time.Duration(tc.late) * time.Second)
			}
			var scheduledArg any = scheduled
			status := "SCHEDULED"
			if tc.source != "APPOINTMENT" {
				scheduledArg = nil
				arrived = nil
				status = "WAITING"
			}
			execSQL(t, ctx, p, `UPDATE tickets SET source=$2,status=$3,scheduled_at=$4,queue_entered_at=$5,arrived_at=$6 WHERE id=$1::uuid`, a.ID, tc.source, status, scheduledArg, scheduled, arrived)
			pol := policy
			pol.AppointmentGraceMinutes = tc.grace
			pol.AppointmentLatePenaltyPerMinute = tc.rate
			pol.AppointmentLatePenaltyMaxPoints = tc.cap
			pol.AntiStarvationThresholdMinutes = tc.threshold
			pol.AntiStarvationPointsPerMinute = tc.boost
			var id, st string
			var eq time.Time
			var priority int64
			err := p.pool.QueryRow(ctx, rankedCandidates, rankingArgs(window1, demoBranch, at, pol)...).Scan(&id, &st, &eq, &priority)
			if err != nil || priority != tc.want || !eq.Equal(effective) {
				t.Fatalf("priority=%d want=%d time=%s want=%s err=%v", priority, tc.want, eq, effective, err)
			}
		})
	}
}

func TestSprint3ArrivalAndNoShow(t *testing.T) {
	ctx, p, _ := integration(t)
	a := book(t, ctx, p, "arrive", parcels).Appointment.Ticket
	first, err := p.ArriveAppointment(ctx, a.ID)
	if err != nil || first.Ticket.ArrivedAt == nil || first.Ticket.Status != domain.TicketStatusScheduled || !first.Ticket.QueueEnteredAt.Equal(a.QueueEnteredAt) {
		t.Fatalf("arrival=%+v %v", first, err)
	}
	second, err := p.ArriveAppointment(ctx, a.ID)
	if err != nil || !second.Ticket.ArrivedAt.Equal(*first.Ticket.ArrivedAt) {
		t.Fatal(second, err)
	}
	e := events(t, ctx, p, a.ID, 2)[1]
	if e.Type != domain.TicketEventArrived || *e.FromStatus != domain.TicketStatusScheduled || e.ToStatus != domain.TicketStatusScheduled || !e.OccurredAt.Equal(*first.Ticket.ArrivedAt) {
		t.Fatal(e)
	}
	pos, err := p.GetQueuePosition(ctx, a.ID)
	// Current schedule policy: early check-in joins the live queue immediately.
	if err != nil || pos.Reason != domain.QueuePositionAvailable || pos.Position == nil || *pos.Position != 1 || pos.ReferenceWindow == nil || first.Ticket.SourceRank != 2 {
		t.Fatal(pos, err)
	}
	_, err = p.MarkNoShow(ctx, a.ID)
	wantError(t, err, application.ErrInvalidState)
	due(t, ctx, p, a.ID)
	_, err = p.CallNext(ctx, window1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = p.ArriveAppointment(ctx, a.ID)
	wantError(t, err, application.ErrInvalidState)
	for _, ticket := range []domain.Ticket{a, create(t, ctx, p, parcels, "qr"), live(t, ctx, p, "live", parcels)} {
		if ticket.ID != a.ID {
			_, err = p.ArriveAppointment(ctx, ticket.ID)
			wantError(t, err, application.ErrInvalidState)
			_, err = p.CallNext(ctx, window1)
			if err != nil {
				t.Fatal(err)
			}
		}
		ns, err := p.MarkNoShow(ctx, ticket.ID)
		if err != nil || ns.Status != domain.TicketStatusNoShow || ns.NoShowAt == nil || ns.Window == nil || ns.Window.ID != window1 {
			t.Fatal(ns, err)
		}
		replay, err := p.MarkNoShow(ctx, ticket.ID)
		if err != nil || !replay.NoShowAt.Equal(*ns.NoShowAt) {
			t.Fatal(replay, err)
		}
		ev, err := p.ListTicketEvents(ctx, ticket.ID)
		if err != nil {
			t.Fatal(err)
		}
		last := ev[len(ev)-1]
		if last.Type != domain.TicketEventNoShow || *last.FromStatus != domain.TicketStatusCalled || *last.WindowID != window1 || !last.OccurredAt.Equal(*ns.NoShowAt) {
			t.Fatal(last)
		}
		current, err := p.GetCurrentTicket(ctx, window1)
		if err != nil || current != nil {
			t.Fatal(current, err)
		}
		pos, err = p.GetQueuePosition(ctx, ticket.ID)
		if err != nil || pos.Reason != domain.QueuePositionNotQueued || pos.Position != nil {
			t.Fatal(pos, err)
		}
		_, err = p.StartService(ctx, ticket.ID)
		wantError(t, err, application.ErrInvalidState)
	}
	_, err = p.CallNext(ctx, window1)
	wantError(t, err, application.ErrNoEligibleTickets)
	_, err = p.ArriveAppointment(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	_, err = p.MarkNoShow(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	_, err = p.GetQueuePosition(ctx, missing)
	wantError(t, err, application.ErrNotFound)
}

func TestSprint3PositionAndMixedOrdering(t *testing.T) {
	ctx, p, _ := integration(t)
	qr := create(t, ctx, p, parcels, "aged-qr")
	l := live(t, ctx, p, "aged-live", parcels)
	a := book(t, ctx, p, "due", parcels).Appointment.Ticket
	due(t, ctx, p, a.ID)
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=date_trunc('minute',now())-interval '32 minutes' WHERE id IN ($1::uuid,$2::uuid)`, qr.ID, l.ID)
	// Under due_at scheduling: qr has source_rank 2, live has source_rank 3,
	// so qr is always ahead of live when due_at is identical.
	ids := []string{qr.ID, l.ID, a.ID}
	for i, id := range ids {
		pos, err := p.GetQueuePosition(ctx, id)
		if err != nil || pos.Reason != domain.QueuePositionAvailable || *pos.Position != i+1 || pos.ReferenceWindow.ID != window1 {
			t.Fatalf("position=%+v %v", pos, err)
		}
	}
	pos, err := p.GetQueuePosition(ctx, ids[0])
	if err != nil {
		t.Fatal(err)
	}
	called, err := p.CallNext(ctx, pos.ReferenceWindow.ID)
	if err != nil || called.ID != ids[0] {
		t.Fatal(called, err)
	}
	e := events(t, ctx, p, called.ID, 2)[1]
	if *e.DecisionPriority < *pos.EffectivePriority || *e.PolicyVersion != 2 || !e.OccurredAt.Equal(*called.CalledAt) {
		t.Fatal(e)
	}
	// Busy window #1 is still the reference; its next candidate ranks first.
	pos, err = p.GetQueuePosition(ctx, ids[1])
	if err != nil || *pos.Position != 1 || pos.ReferenceWindow.ID != window1 {
		t.Fatal(pos, err)
	}
	_, err = p.CallNext(ctx, window1)
	wantError(t, err, application.ErrWindowBusy)
	execSQL(t, ctx, p, `UPDATE windows SET status='CLOSED' WHERE id=$1::uuid`, window1)
	pos, err = p.GetQueuePosition(ctx, ids[1])
	if err != nil || pos.ReferenceWindow.ID != window3 {
		t.Fatal(pos, err)
	}
	execSQL(t, ctx, p, `UPDATE windows SET status='CLOSED' WHERE id=$1::uuid`, window3)
	pos, err = p.GetQueuePosition(ctx, ids[1])
	if err != nil || pos.Reason != domain.QueuePositionNoOpenCompatibleWindow || pos.Position != nil || pos.ReferenceWindow != nil || pos.EffectivePriority != nil || pos.EffectiveQueueTime != nil {
		t.Fatal(pos, err)
	}
	// Reference-window candidates include every service that window supports.
	pay := create(t, ctx, p, payments, "pay")
	execSQL(t, ctx, p, `UPDATE windows SET status='OPEN' WHERE id=$1::uuid`, window1)
	execSQL(t, ctx, p, `INSERT INTO window_services(window_id,branch_id,service_id) VALUES($1::uuid,$2::uuid,$3::uuid)`, window1, demoBranch, payments)
	pos, err = p.GetQueuePosition(ctx, pay.ID)
	if err != nil || pos.ReferenceWindow.ID != window1 || *pos.Position != 3 {
		t.Fatal(pos, err)
	}
}

func TestSprint3ConcurrentTransitions(t *testing.T) {
	t.Run("no-show versus start", func(t *testing.T) {
		ctx, p, _ := integration(t)
		for n := 0; n < 15; n++ {
			ticket := live(t, ctx, p, fmt.Sprint(n), parcels)
			if _, err := p.CallNext(ctx, window1); err != nil {
				t.Fatal(err)
			}
			var errs [2]error
			concurrently(2, func(i int) {
				if i == 0 {
					_, errs[i] = p.MarkNoShow(ctx, ticket.ID)
				} else {
					_, errs[i] = p.StartService(ctx, ticket.ID)
				}
			})
			successes := 0
			for _, err := range errs {
				if err == nil {
					successes++
				} else {
					wantError(t, err, application.ErrInvalidState)
				}
			}
			if successes != 1 {
				t.Fatal(errs)
			}
			final, err := p.GetTicket(ctx, ticket.ID)
			if err != nil {
				t.Fatal(err)
			}
			events(t, ctx, p, ticket.ID, 3)
			if final.Status == domain.TicketStatusServing {
				if _, err = p.CompleteService(ctx, ticket.ID); err != nil {
					t.Fatal(err)
				}
			} else if final.Status != domain.TicketStatusNoShow {
				t.Fatal(final)
			}
		}
	})
	t.Run("arrival versus claim", func(t *testing.T) {
		ctx, p, _ := integration(t)
		for n := 0; n < 15; n++ {
			a := book(t, ctx, p, fmt.Sprint(n), parcels).Appointment.Ticket
			due(t, ctx, p, a.ID)
			var arrivalErr, claimErr error
			concurrently(2, func(i int) {
				if i == 0 {
					_, arrivalErr = p.ArriveAppointment(ctx, a.ID)
				} else {
					_, claimErr = p.CallNext(ctx, window1)
				}
			})
			if arrivalErr != nil {
				wantError(t, arrivalErr, application.ErrInvalidState)
			}
			// SKIP LOCKED may observe the arrival transaction holding the candidate.
			if claimErr != nil {
				wantError(t, claimErr, application.ErrNoEligibleTickets)
				_, claimErr = p.CallNext(ctx, window1)
			}
			if claimErr != nil {
				t.Fatal(claimErr)
			}
			count := 2
			if arrivalErr == nil {
				count++
			}
			events(t, ctx, p, a.ID, count)
			_, err := p.ArriveAppointment(ctx, a.ID)
			wantError(t, err, application.ErrInvalidState)
			if _, err = p.MarkNoShow(ctx, a.ID); err != nil {
				t.Fatal(err)
			}
		}
	})
	t.Run("no-show versus call", func(t *testing.T) {
		ctx, p, _ := integration(t)
		first := live(t, ctx, p, "first", parcels)
		second := live(t, ctx, p, "second", parcels)
		if _, err := p.CallNext(ctx, window1); err != nil {
			t.Fatal(err)
		}
		var nsErr, callErr error
		var next domain.Ticket
		concurrently(2, func(i int) {
			if i == 0 {
				_, nsErr = p.MarkNoShow(ctx, first.ID)
			} else {
				next, callErr = p.CallNext(ctx, window1)
			}
		})
		if nsErr != nil {
			t.Fatal(nsErr)
		}
		if callErr != nil {
			wantError(t, callErr, application.ErrWindowBusy)
			next, callErr = p.CallNext(ctx, window1)
		}
		if callErr != nil || next.ID != second.ID {
			t.Fatal(next, callErr)
		}
		events(t, ctx, p, first.ID, 3)
		events(t, ctx, p, second.ID, 2)
	})
	t.Run("mixed simultaneous claims", func(t *testing.T) {
		ctx, p, _ := integration(t)
		a := book(t, ctx, p, "a", parcels).Appointment.Ticket
		due(t, ctx, p, a.ID)
		live(t, ctx, p, "l", parcels)
		create(t, ctx, p, parcels, "q")
		var tickets [2]domain.Ticket
		var errs [2]error
		concurrently(2, func(i int) { tickets[i], errs[i] = p.CallNext(ctx, []string{window1, window3}[i]) })
		if errs[0] != nil || errs[1] != nil || tickets[0].ID == tickets[1].ID {
			t.Fatal(tickets, errs)
		}
		for _, ticket := range tickets {
			events(t, ctx, p, ticket.ID, 2)
		}
	})
}

func TestSprint3EventRollback(t *testing.T) {
	ctx, p, _ := integration(t)
	a := book(t, ctx, p, "a", parcels).Appointment.Ticket
	l := live(t, ctx, p, "l", parcels)
	if _, err := p.CallNext(ctx, window1); err != nil {
		t.Fatal(err)
	}
	execSQL(t, ctx, p, `ALTER TABLE ticket_events ADD CONSTRAINT injected_failure CHECK (id<0) NOT VALID`)
	_, err := p.ArriveAppointment(ctx, a.ID)
	if err == nil {
		t.Fatal("arrival without event")
	}
	_, err = p.MarkNoShow(ctx, l.ID)
	if err == nil {
		t.Fatal("no-show without event")
	}
	_, err = p.CreateLiveTicket(ctx, application.CreateLiveTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "failed-live"})
	if err == nil {
		t.Fatal("LIVE without event")
	}
	got, err := p.GetTicket(ctx, a.ID)
	if err != nil || got.ArrivedAt != nil {
		t.Fatal(got, err)
	}
	got, err = p.GetTicket(ctx, l.ID)
	if err != nil || got.Status != domain.TicketStatusCalled || got.NoShowAt != nil {
		t.Fatal(got, err)
	}
	var count int
	if err = p.pool.QueryRow(ctx, `SELECT count(*) FROM tickets WHERE idempotency_key='failed-live'`).Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
	events(t, ctx, p, a.ID, 1)
	events(t, ctx, p, l.ID, 2)
}

func TestSprint3PolicyValidation(t *testing.T) {
	ctx, p, _ := integration(t)
	policy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	if policy.Version != 2 || policy.LivePriority != 10 || policy.AntiStarvationThresholdMinutes != 15 || policy.AntiStarvationPointsPerMinute != 10 || policy.AppointmentGraceMinutes != 15 || policy.AppointmentLatePenaltyPerMinute != 5 || policy.AppointmentLatePenaltyMaxPoints != 90 {
		t.Fatal(policy)
	}
	changes := []func(*application.UpdateQueuePolicyCommand){
		func(c *application.UpdateQueuePolicyCommand) { c.LivePriority = -1 }, func(c *application.UpdateQueuePolicyCommand) { c.LivePriority = 1001 }, func(c *application.UpdateQueuePolicyCommand) { c.LivePriority = 100 },
		func(c *application.UpdateQueuePolicyCommand) { c.AntiStarvationThresholdMinutes = -1 }, func(c *application.UpdateQueuePolicyCommand) { c.AntiStarvationThresholdMinutes = 241 },
		func(c *application.UpdateQueuePolicyCommand) { c.AntiStarvationPointsPerMinute = 0 }, func(c *application.UpdateQueuePolicyCommand) { c.AntiStarvationPointsPerMinute = 601 },
		func(c *application.UpdateQueuePolicyCommand) { c.AppointmentGraceMinutes = -1 }, func(c *application.UpdateQueuePolicyCommand) { c.AppointmentGraceMinutes = 121 },
		func(c *application.UpdateQueuePolicyCommand) { c.AppointmentLatePenaltyPerMinute = -1 }, func(c *application.UpdateQueuePolicyCommand) { c.AppointmentLatePenaltyPerMinute = 601 },
		func(c *application.UpdateQueuePolicyCommand) { c.AppointmentLatePenaltyMaxPoints = -1 }, func(c *application.UpdateQueuePolicyCommand) { c.AppointmentLatePenaltyMaxPoints = 101 },
	}
	for _, change := range changes {
		c := policyCommand(policy)
		change(&c)
		_, err = p.UpdateQueuePolicy(ctx, c)
		wantError(t, err, application.ErrInvalidState)
	}
	c := policyCommand(policy)
	c.AppointmentDuePriority = 1000
	c.QRPriority = 0
	c.LivePriority = 999
	c.AntiStarvationThresholdMinutes = 240
	c.AntiStarvationPointsPerMinute = 600
	c.AppointmentGraceMinutes = 120
	c.AppointmentLatePenaltyPerMinute = 600
	c.AppointmentLatePenaltyMaxPoints = 1000
	updated, err := p.UpdateQueuePolicy(ctx, c)
	if err != nil || updated.Version != 3 {
		t.Fatal(updated, err)
	}
	c = policyCommand(updated)
	c.LivePriority = 0
	c.AntiStarvationThresholdMinutes = 0
	c.AntiStarvationPointsPerMinute = 1
	c.AppointmentGraceMinutes = 0
	c.AppointmentLatePenaltyPerMinute = 0
	c.AppointmentLatePenaltyMaxPoints = 0
	updated, err = p.UpdateQueuePolicy(ctx, c)
	if err != nil || updated.Version != 4 {
		t.Fatal(updated, err)
	}
	_, err = p.UpdateQueuePolicy(ctx, c)
	wantError(t, err, application.ErrPolicyVersionConflict)
	updated, err = p.UpdateQueuePolicy(ctx, policyCommand(updated))
	if err != nil || updated.Version != 5 {
		t.Fatal(updated, err)
	}
	// A complete Core command is mandatory: API owns the legacy partial PUT merge.
	_, err = p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{BranchID: demoBranch, AppointmentDuePriority: 100, QRPriority: 10, ExpectedVersion: 5})
	wantError(t, err, application.ErrInvalidState)
}

func TestSprint3MigrationAndConstraints(t *testing.T) {
	ctx, p, m := integration(t)
	downTo(t, m, migrationPreSprint3)
	execSQL(t, ctx, p, `UPDATE queue_policies SET appointment_due_priority=5,qr_priority=1,version=8`)
	// Sequence reconciliation preserves historical LIVE public numbers.
	execSQL(t, ctx, p, `INSERT INTO tickets(branch_id,service_id,source,status,idempotency_key,public_number) VALUES($1::uuid,$2::uuid,'LIVE','WAITING','historical-live','L-000050')`, demoBranch, parcels)
	if err := m.Up(); err != nil {
		t.Fatal(err)
	}
	policy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil || policy.Version != 9 || policy.AppointmentDuePriority != 100 || policy.QRPriority != 10 {
		t.Fatal(policy, err)
	}
	ticket := live(t, ctx, p, "next", parcels)
	if ticket.PublicNumber != "L-000051" {
		t.Fatal(ticket)
	}
	for _, sql := range []string{
		`UPDATE tickets SET arrived_at=now() WHERE source='LIVE'`,
		`UPDATE tickets SET status='NO_SHOW' WHERE source='LIVE'`,
		`UPDATE tickets SET no_show_at=now() WHERE source='LIVE'`,
		`UPDATE tickets SET status='NO_SHOW',no_show_at=now() WHERE source='LIVE'`,
		`UPDATE queue_policies SET live_priority=appointment_due_priority`,
		`UPDATE queue_policies SET appointment_late_penalty_max_points=1001`,
		`UPDATE queue_policies SET anti_starvation_points_per_minute=0`,
	} {
		if _, err = p.pool.Exec(ctx, sql); err == nil {
			t.Fatalf("constraint accepted: %s", sql)
		}
	}
	// Rollback without Sprint 3-only facts is lossless and re-upgrade reconciles L numbers.
	downTo(t, m, migrationPreSprint3)
	if err = m.Up(); err != nil {
		t.Fatal(err)
	}
	if next := live(t, ctx, p, "after-up", parcels); next.PublicNumber != "L-000052" {
		t.Fatal(next)
	}
}

func TestSprint3ConcurrentSourceConflict(t *testing.T) {
	ctx, p, _ := integration(t)
	var errs [3]error
	concurrently(3, func(i int) {
		switch i {
		case 0:
			_, errs[i] = p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "shared"})
		case 1:
			_, errs[i] = p.CreateLiveTicket(ctx, application.CreateLiveTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "shared"})
		case 2:
			_, errs[i] = p.CreateAppointment(ctx, application.CreateAppointmentCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "shared", ScheduledAt: time.Now().Add(time.Hour)})
		}
	})
	n := 0
	for _, err := range errs {
		if err == nil {
			n++
		} else if !errors.Is(err, application.ErrIdempotencyConflict) {
			t.Fatal(err)
		}
	}
	if n != 1 {
		t.Fatal(errs)
	}
	var count int
	if err := p.pool.QueryRow(ctx, `SELECT count(*) FROM ticket_events`).Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
}

func TestSprint3PositionConsistentSnapshot(t *testing.T) {
	ctx, p, _ := integration(t)
	ticket := create(t, ctx, p, parcels, "snapshot")
	locker, err := p.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer locker.Rollback(context.Background())
	if _, err = locker.Exec(ctx, `LOCK TABLE windows IN ACCESS EXCLUSIVE MODE`); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	var pos domain.QueuePosition
	var positionErr error
	go func() { defer close(done); pos, positionErr = p.GetQueuePosition(ctx, ticket.ID) }()
	// The position transaction has established its snapshot before waiting for
	// ticketSelect's window join. Change policy/window state while it is blocked.
	deadline := time.Now().Add(5 * time.Second)
	for {
		var waiting bool
		if err = p.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE relation='windows'::regclass AND NOT granted)`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("position did not reach read")
		}
		time.Sleep(time.Millisecond)
	}
	if _, err = locker.Exec(ctx, `UPDATE windows SET status='CLOSED'; UPDATE queue_policies SET qr_priority=50,version=version+1`); err != nil {
		t.Fatal(err)
	}
	if err = locker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	<-done
	if positionErr != nil || pos.Reason != domain.QueuePositionAvailable || *pos.EffectivePriority != 10 || pos.ReferenceWindow.ID != window1 {
		t.Fatal(pos, positionErr)
	}
	next, err := p.GetQueuePosition(ctx, ticket.ID)
	if err != nil || next.Reason != domain.QueuePositionNoOpenCompatibleWindow {
		t.Fatal(next, err)
	}
}

func TestSprint3DecisionAuditExact(t *testing.T) {
	ctx, p, _ := integration(t)
	a := book(t, ctx, p, "late-decision", parcels).Appointment.Ticket
	execSQL(t, ctx, p, `UPDATE tickets SET scheduled_at=now()-interval '60 minutes',queue_entered_at=now()-interval '60 minutes',arrived_at=now()-interval '25 minutes' WHERE id=$1::uuid`, a.ID)
	called, err := p.CallNext(ctx, window1)
	if err != nil {
		t.Fatal(err)
	}
	policy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	// Restore eligibility only inside a rolled-back test transaction and evaluate
	// the shared primitive at exactly the persisted decision time.
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `UPDATE tickets SET status='SCHEDULED',window_id=NULL WHERE id=$1::uuid`, a.ID); err != nil {
		t.Fatal(err)
	}
	var id, status string
	var at time.Time
	var priority int64
	if err = tx.QueryRow(ctx, rankedCandidates, rankingArgs(window1, demoBranch, *called.CalledAt, policy)...).Scan(&id, &status, &at, &priority); err != nil {
		t.Fatal(err)
	}
	ev := events(t, ctx, p, a.ID, 2)[1]
	// 35 minutes late => capped penalty 90; 25 minutes waiting => boost 100.
	if priority != 110 || *ev.DecisionPriority != priority || *ev.PolicyVersion != policy.Version || !ev.OccurredAt.Equal(*called.CalledAt) {
		t.Fatalf("priority=%d audit=%+v", priority, ev)
	}
}

func TestSprint3FractionalSeconds(t *testing.T) {
	ctx, p, _ := integration(t)
	a := book(t, ctx, p, "fraction", parcels).Appointment.Ticket
	policy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	policy.AntiStarvationThresholdMinutes = 0
	policy.AntiStarvationPointsPerMinute = 600
	policy.AppointmentGraceMinutes = 0
	policy.AppointmentLatePenaltyPerMinute = 600
	at := time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		late, wait time.Duration
		want       int64
	}{
		{999 * time.Millisecond, 999 * time.Millisecond, 100},
		{time.Second, 999 * time.Millisecond, 90},
		{999 * time.Millisecond, time.Second, 110},
		{1900 * time.Millisecond, 2900 * time.Millisecond, 110},
	} {
		arrived := at.Add(-tc.wait)
		scheduled := arrived.Add(-tc.late)
		execSQL(t, ctx, p, `UPDATE tickets SET scheduled_at=$2,queue_entered_at=$2,arrived_at=$3 WHERE id=$1::uuid`, a.ID, scheduled, arrived)
		var id, status string
		var eq time.Time
		var priority int64
		err = p.pool.QueryRow(ctx, rankedCandidates, rankingArgs(window1, demoBranch, at, policy)...).Scan(&id, &status, &eq, &priority)
		if err != nil || priority != tc.want {
			t.Fatalf("fraction=%+v priority=%d err=%v", tc, priority, err)
		}
	}
}

func TestSprint3LivePersistenceAndNoShowReplay(t *testing.T) {
	ctx, p, _ := integration(t)
	cmd := application.CreateLiveTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "persistent-live"}
	created, err := p.CreateLiveTicket(ctx, cmd)
	if err != nil {
		t.Fatal(err)
	}
	freshPool, err := pgxpool.NewWithConfig(ctx, p.pool.Config())
	if err != nil {
		t.Fatal(err)
	}
	defer freshPool.Close()
	fresh := New(freshPool)
	replay, err := fresh.CreateLiveTicket(ctx, cmd)
	if err != nil || !replay.Replayed || replay.Ticket.ID != created.Ticket.ID {
		t.Fatal(replay, err)
	}
	if _, err = fresh.CallNext(ctx, window1); err != nil {
		t.Fatal(err)
	}
	var results [8]domain.Ticket
	var errs [8]error
	concurrently(8, func(i int) { results[i], errs[i] = fresh.MarkNoShow(ctx, created.Ticket.ID) })
	for i, r := range results {
		if errs[i] != nil || r.Status != domain.TicketStatusNoShow || !r.NoShowAt.Equal(*results[0].NoShowAt) {
			t.Fatal(r, errs[i])
		}
	}
	events(t, ctx, p, created.Ticket.ID, 3)
	for _, source := range []string{"QR", "LIVE", "APPOINTMENT"} {
		var ticket domain.Ticket
		switch source {
		case "QR":
			ticket = create(t, ctx, p, parcels, "q")
		case "LIVE":
			ticket = live(t, ctx, p, "l", parcels)
		default:
			ticket = book(t, ctx, p, "a", parcels).Appointment.Ticket
			due(t, ctx, p, ticket.ID)
		}
		_, err = p.CallNext(ctx, window1)
		if err != nil {
			t.Fatal(err)
		}
		for _, step := range []func(context.Context, string) (domain.Ticket, error){p.StartService, p.CompleteService} {
			if _, err = step(ctx, ticket.ID); err != nil {
				t.Fatal(err)
			}
			_, err = p.MarkNoShow(ctx, ticket.ID)
			wantError(t, err, application.ErrInvalidState)
			pos, err := p.GetQueuePosition(ctx, ticket.ID)
			if err != nil || pos.Reason != domain.QueuePositionNotQueued || pos.Position != nil || pos.ReferenceWindow != nil {
				t.Fatal(pos, err)
			}
		}
	}
	a := book(t, ctx, p, "cancel", parcels).Appointment.Ticket
	if _, err = p.CancelAppointment(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	_, err = p.MarkNoShow(ctx, a.ID)
	wantError(t, err, application.ErrInvalidState)
	_, err = p.ArriveAppointment(ctx, a.ID)
	wantError(t, err, application.ErrInvalidState)
	pos, err := p.GetQueuePosition(ctx, a.ID)
	if err != nil || pos.Reason != domain.QueuePositionNotQueued {
		t.Fatal(pos, err)
	}
}

func TestSprint3MigrationRollbackProtectsAudit(t *testing.T) {
	ctx, p, _ := integration(t)
	a := book(t, ctx, p, "arrival", parcels).Appointment.Ticket
	if _, err := p.ArriveAppointment(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	sql, err := os.ReadFile("../../migrations/000006_sprint3_queue_engine.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, string(sql)); err == nil {
		t.Fatal("lossy downgrade accepted")
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	got, err := p.GetTicket(ctx, a.ID)
	if err != nil || got.ArrivedAt == nil {
		t.Fatal(got, err)
	}
	events(t, ctx, p, a.ID, 2)
}

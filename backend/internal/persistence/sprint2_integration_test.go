package persistence

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func book(t *testing.T, ctx context.Context, p *Postgres, key, service string) application.CreateAppointmentResult {
	t.Helper()
	r, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{BranchID: demoBranch, ServiceID: service, ScheduledAt: time.Now().Add(time.Hour), IdempotencyKey: key})
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func due(t *testing.T, ctx context.Context, p *Postgres, id string) {
	t.Helper()
	execSQL(t, ctx, p, `UPDATE tickets SET scheduled_at=date_trunc('minute',now())-interval '1 minute',queue_entered_at=date_trunc('minute',now())-interval '1 minute' WHERE id=$1::uuid`, id)
}
func events(t *testing.T, ctx context.Context, p *Postgres, id string, n int) []domain.TicketEvent {
	t.Helper()
	e, err := p.ListTicketEvents(ctx, id)
	if err != nil || len(e) != n {
		t.Fatalf("events=%+v err=%v want=%d", e, err, n)
	}
	return e
}
func TestAppointmentCreationReplayAndCancel(t *testing.T) {
	ctx, p, _ := integration(t)
	cmd := application.CreateAppointmentCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "appointment", ScheduledAt: time.Now().Add(time.Hour).Truncate(time.Microsecond)}
	r, err := p.CreateAppointment(ctx, cmd)
	if err != nil {
		t.Fatal(err)
	}
	a := r.Appointment
	if r.Replayed || a.Ticket.Status != domain.TicketStatusScheduled || a.Ticket.Source != domain.TicketSourceAppointment || a.Ticket.PublicNumber != "A-000001" || a.Ticket.ScheduledAt == nil || !a.ScheduledAt.Equal(cmd.ScheduledAt) || !a.Ticket.QueueEnteredAt.Equal(a.ScheduledAt) {
		t.Fatalf("appointment=%+v", r)
	}
	e := events(t, ctx, p, a.Ticket.ID, 1)[0]
	if e.Type != domain.TicketEventCreated || e.FromStatus != nil || e.ToStatus != domain.TicketStatusScheduled || e.WindowID != nil || e.PolicyVersion != nil || e.DecisionPriority != nil || !e.OccurredAt.Equal(a.Ticket.CreatedAt) {
		t.Fatalf("created=%+v", e)
	}
	cmd.ScheduledAt = cmd.ScheduledAt.In(time.FixedZone("offset", 3*3600))
	replay, err := p.CreateAppointment(ctx, cmd)
	if err != nil || !replay.Replayed || replay.Appointment.Ticket.ID != a.Ticket.ID {
		t.Fatalf("replay=%+v %v", replay, err)
	}
	for _, change := range []func(*application.CreateAppointmentCommand){func(c *application.CreateAppointmentCommand) { c.ServiceID = payments }, func(c *application.CreateAppointmentCommand) { c.BranchID = missing }, func(c *application.CreateAppointmentCommand) { c.ScheduledAt = c.ScheduledAt.Add(time.Second) }} {
		c := cmd
		change(&c)
		_, err = p.CreateAppointment(ctx, c)
		wantError(t, err, application.ErrIdempotencyConflict)
	}
	_, err = p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: cmd.IdempotencyKey})
	wantError(t, err, application.ErrIdempotencyConflict)
	qr := create(t, ctx, p, parcels, "qr")
	c := cmd
	c.IdempotencyKey = "qr"
	_, err = p.CreateAppointment(ctx, c)
	wantError(t, err, application.ErrIdempotencyConflict)
	for _, when := range []time.Time{time.Time{}, time.Now().Add(-time.Hour)} {
		c := cmd
		c.IdempotencyKey = "past"
		c.ScheduledAt = when
		_, err = p.CreateAppointment(ctx, c)
		wantError(t, err, application.ErrInvalidState)
	}
	c = cmd
	c.IdempotencyKey = "missing"
	c.ServiceID = missing
	_, err = p.CreateAppointment(ctx, c)
	wantError(t, err, application.ErrNotFound)
	_, err = p.CancelAppointment(ctx, qr.ID)
	wantError(t, err, application.ErrInvalidState)
	_, err = p.CancelAppointment(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	for i := 0; i < 2; i++ {
		cancelled, err := p.CancelAppointment(ctx, a.Ticket.ID)
		if err != nil || cancelled.Ticket.Status != domain.TicketStatusCancelled || cancelled.Ticket.Window != nil {
			t.Fatalf("cancel=%+v %v", cancelled, err)
		}
	}
	e = events(t, ctx, p, a.Ticket.ID, 2)[1]
	if e.Type != domain.TicketEventCancelled || e.FromStatus == nil || *e.FromStatus != domain.TicketStatusScheduled || e.ToStatus != domain.TicketStatusCancelled {
		t.Fatalf("cancel event=%+v", e)
	}
	replay, err = p.CreateAppointment(ctx, cmd)
	if err != nil || !replay.Replayed || replay.Appointment.Ticket.Status != domain.TicketStatusCancelled {
		t.Fatalf("cancelled replay=%+v %v", replay, err)
	}
	due(t, ctx, p, a.Ticket.ID)
	claimed, err := p.CallNext(ctx, window1)
	if err != nil || claimed.ID != qr.ID {
		t.Fatalf("cancelled assigned: %+v %v", claimed, err)
	}
}
func TestAppointmentQueuePolicyAndLifecycle(t *testing.T) {
	ctx, p, _ := integration(t)
	a := book(t, ctx, p, "future", parcels).Appointment.Ticket
	_, err := p.CallNext(ctx, window1)
	wantError(t, err, application.ErrNotEligibleYet)
	due(t, ctx, p, a.ID)
	_, err = p.CallNext(ctx, window2)
	wantError(t, err, application.ErrNoEligibleTickets)
	qr := create(t, ctx, p, parcels, "older-qr")
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=now()-interval '2 minutes' WHERE id=$1::uuid`, qr.ID)
	claimed, err := p.CallNext(ctx, window1)
	if err != nil || claimed.ID != a.ID {
		t.Fatalf("due priority: %+v %v", claimed, err)
	}

	e := events(t, ctx, p, a.ID, 2)[1]
	if e.Type != domain.TicketEventCalled || e.FromStatus == nil || *e.FromStatus != domain.TicketStatusScheduled || e.PolicyVersion == nil || *e.PolicyVersion != 2 || e.DecisionPriority == nil || *e.DecisionPriority != 100 || e.WindowID == nil || *e.WindowID != window1 {
		t.Fatalf("called=%+v", e)
	}
	for _, step := range []func(context.Context, string) (domain.Ticket, error){nil, p.StartService, p.CompleteService} {
		if step != nil {
			if _, err = step(ctx, a.ID); err != nil {
				t.Fatal(err)
			}
		}
		_, err = p.CancelAppointment(ctx, a.ID)
		wantError(t, err, application.ErrInvalidState)
	}
	ev := events(t, ctx, p, a.ID, 4)
	for i, kind := range []domain.TicketEventType{domain.TicketEventCreated, domain.TicketEventCalled, domain.TicketEventServiceStarted, domain.TicketEventCompleted} {
		if ev[i].Type != kind {
			t.Fatal(ev)
		}
	}
	if ev[2].PolicyVersion != nil || ev[3].DecisionPriority != nil {
		t.Fatal(ev)
	}
	claimed, err = p.CallNext(ctx, window1)
	if err != nil || claimed.ID != qr.ID {
		t.Fatalf("QR regression: %v %v", claimed, err)
	}
	e = events(t, ctx, p, qr.ID, 2)[1]
	if *e.FromStatus != domain.TicketStatusWaiting || *e.DecisionPriority != 10 {
		t.Fatal(e)
	}
	if _, err = p.StartService(ctx, qr.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = p.CompleteService(ctx, qr.ID); err != nil {
		t.Fatal(err)
	}
	events(t, ctx, p, qr.ID, 4)
}
func TestAppointmentDeterministicAndConcurrent(t *testing.T) {
	t.Run("same key", func(t *testing.T) {
		ctx, p, _ := integration(t)
		cmd := application.CreateAppointmentCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "concurrent", ScheduledAt: time.Now().Add(time.Hour)}
		var rs [12]application.CreateAppointmentResult
		var errs [12]error
		concurrently(12, func(i int) { rs[i], errs[i] = p.CreateAppointment(ctx, cmd) })
		count := 0
		for i, r := range rs {
			if errs[i] != nil {
				t.Fatal(errs[i])
			}
			if !r.Replayed {
				count++
			}
			if r.Appointment.Ticket.ID != rs[0].Appointment.Ticket.ID {
				t.Fatal("duplicate")
			}
		}
		if count != 1 {
			t.Fatal(count)
		}
		events(t, ctx, p, rs[0].Appointment.Ticket.ID, 1)
		var allocated int
		if err := p.pool.QueryRow(ctx, `SELECT last_value FROM appointment_public_number_seq`).Scan(&allocated); err != nil || allocated != 1 {
			t.Fatalf("numbers=%d %v", allocated, err)
		}
	})
	t.Run("equal tier", func(t *testing.T) {
		ctx, p, _ := integration(t)
		a := book(t, ctx, p, "a", parcels).Appointment.Ticket
		b := book(t, ctx, p, "b", parcels).Appointment.Ticket
		due(t, ctx, p, a.ID)
		due(t, ctx, p, b.ID)
		if b.ID < a.ID {
			a, b = b, a
		}
		r, err := p.CallNext(ctx, window1)
		if err != nil || r.ID != a.ID {
			t.Fatalf("tie=%+v %v", r, err)
		}
		r, err = p.CallNext(ctx, window3)
		if err != nil || r.ID != b.ID {
			t.Fatalf("tie=%+v %v", r, err)
		}
	})
	t.Run("double claim", func(t *testing.T) {
		ctx, p, _ := integration(t)
		a := book(t, ctx, p, "a", parcels).Appointment.Ticket
		due(t, ctx, p, a.ID)
		var errs [2]error
		var rs [2]domain.Ticket
		concurrently(2, func(i int) { rs[i], errs[i] = p.CallNext(ctx, []string{window1, window3}[i]) })
		n := 0
		for i, err := range errs {
			if err == nil {
				n++
				if rs[i].ID != a.ID {
					t.Fatal(rs)
				}
			} else {
				wantError(t, err, application.ErrNoEligibleTickets)
			}
		}
		if n != 1 {
			t.Fatal(n)
		}
		events(t, ctx, p, a.ID, 2)
	})
	t.Run("cancel versus claim", func(t *testing.T) {
		ctx, p, _ := integration(t)
		for i := 0; i < 20; i++ {
			a := book(t, ctx, p, fmt.Sprint(i), parcels).Appointment.Ticket
			due(t, ctx, p, a.ID)
			var cancelErr, claimErr error
			concurrently(2, func(i int) {
				if i == 0 {
					_, cancelErr = p.CancelAppointment(ctx, a.ID)
				} else {
					_, claimErr = p.CallNext(ctx, window1)
				}
			})
			final, err := p.GetTicket(ctx, a.ID)
			if err != nil {
				t.Fatal(err)
			}
			switch final.Status {
			case domain.TicketStatusCancelled:
				if cancelErr != nil || !errors.Is(claimErr, application.ErrNoEligibleTickets) || final.Window != nil {
					t.Fatalf("cancel winner: %v %v %+v", cancelErr, claimErr, final)
				}
			case domain.TicketStatusCalled:
				if claimErr != nil || !errors.Is(cancelErr, application.ErrInvalidState) || final.Window == nil {
					t.Fatalf("claim winner: %v %v %+v", cancelErr, claimErr, final)
				}
			default:
				t.Fatal(final)
			}
			events(t, ctx, p, a.ID, 2)
			if final.Status == domain.TicketStatusCalled {
				if _, err = p.StartService(ctx, a.ID); err != nil {
					t.Fatal(err)
				}
				if _, err = p.CompleteService(ctx, a.ID); err != nil {
					t.Fatal(err)
				}
			}
		}
	})
}
func TestQueuePolicyVersionGuard(t *testing.T) {
	ctx, p, _ := integration(t)
	policy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil || policy.Version != 2 || policy.AppointmentDuePriority != 100 || policy.QRPriority != 10 {
		t.Fatalf("default=%+v %v", policy, err)
	}
	cmd := application.UpdateQueuePolicyCommand{BranchID: demoBranch, AppointmentDuePriority: 100, QRPriority: 10, LivePriority: 10, AntiStarvationThresholdMinutes: 15, AntiStarvationPointsPerMinute: 10, AppointmentGraceMinutes: 15, AppointmentLatePenaltyPerMinute: 5, AppointmentLatePenaltyMaxPoints: 90, ExpectedVersion: 2}
	var rs [2]domain.QueuePolicy
	var errs [2]error
	concurrently(2, func(i int) { rs[i], errs[i] = p.UpdateQueuePolicy(ctx, cmd) })
	n := 0
	for i, err := range errs {
		if err == nil {
			n++
			if rs[i].Version != 3 {
				t.Fatal(rs)
			}
		} else {
			wantError(t, err, application.ErrPolicyVersionConflict)
		}
	}
	if n != 1 {
		t.Fatal(n)
	}
	for _, v := range [][2]int{{0, 0}, {10, 10}, {5, 10}, {1001, 10}, {100, -1}} {
		cmd.AppointmentDuePriority = v[0]
		cmd.QRPriority = v[1]
		_, err = p.UpdateQueuePolicy(ctx, cmd)
		wantError(t, err, application.ErrInvalidState)
	}
	cmd.AppointmentDuePriority = 200
	cmd.QRPriority = 20
	cmd.ExpectedVersion = 3
	updated, err := p.UpdateQueuePolicy(ctx, cmd)
	if err != nil || updated.Version != 4 {
		t.Fatalf("update=%+v %v", updated, err)
	}
	qr := create(t, ctx, p, parcels, "qr")
	if _, err = p.CallNext(ctx, window1); err != nil {
		t.Fatal(err)
	}
	e := events(t, ctx, p, qr.ID, 2)[1]
	if *e.PolicyVersion != 4 || *e.DecisionPriority != 20 {
		t.Fatal(e)
	}
	_, err = p.GetQueuePolicy(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	cmd.BranchID = missing
	_, err = p.UpdateQueuePolicy(ctx, cmd)
	wantError(t, err, application.ErrNotFound)
	execSQL(t, ctx, p, `DELETE FROM queue_policies WHERE branch_id=$1::uuid`, demoBranch)
	_, err = p.CallNext(ctx, window3)
	if err == nil || errors.Is(err, application.ErrNotFound) {
		t.Fatalf("missing configuration=%v", err)
	}
}
func TestTicketEventsRollbackAndHistory(t *testing.T) {
	ctx, p, _ := integration(t)
	var historical string
	if err := p.pool.QueryRow(ctx, `INSERT INTO tickets(branch_id,service_id,source,status,idempotency_key) VALUES($1::uuid,$2::uuid,'QR','WAITING','historical') RETURNING id::text`, demoBranch, parcels).Scan(&historical); err != nil {
		t.Fatal(err)
	}
	events(t, ctx, p, historical, 0)
	_, err := p.ListTicketEvents(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	a := book(t, ctx, p, "a", parcels).Appointment.Ticket
	due(t, ctx, p, a.ID)
	// A real database insertion failure must roll back every covered state change.
	execSQL(t, ctx, p, `ALTER TABLE ticket_events ADD CONSTRAINT injected_failure CHECK (id < 0) NOT VALID`)
	_, err = p.CancelAppointment(ctx, a.ID)
	if err == nil {
		t.Fatal("cancel committed without event")
	}
	_, err = p.CallNext(ctx, window1)
	if err == nil {
		t.Fatal("claim committed without event")
	}
	after, err := p.GetTicket(ctx, a.ID)
	if err != nil || after.Status != domain.TicketStatusScheduled || after.Window != nil {
		t.Fatalf("rollback=%+v %v", after, err)
	}
	_, err = p.CreateAppointment(ctx, application.CreateAppointmentCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "failed-create", ScheduledAt: time.Now().Add(time.Hour)})
	if err == nil {
		t.Fatal("creation committed without event")
	}
	_, err = p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "failed-qr"})
	if err == nil {
		t.Fatal("QR committed without event")
	}
	var count int
	if err = p.pool.QueryRow(ctx, `SELECT count(*) FROM tickets WHERE idempotency_key IN ('failed-create','failed-qr')`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("orphans=%d %v", count, err)
	}
	events(t, ctx, p, a.ID, 1)
	execSQL(t, ctx, p, `ALTER TABLE ticket_events DROP CONSTRAINT injected_failure`)
	if _, err = p.CallNext(ctx, window1); err != nil {
		t.Fatal(err)
	}
	for _, step := range []struct {
		fn     func(context.Context, string) (domain.Ticket, error)
		before domain.TicketStatus
	}{{p.StartService, domain.TicketStatusCalled}, {p.CompleteService, domain.TicketStatusServing}} {
		execSQL(t, ctx, p, `ALTER TABLE ticket_events ADD CONSTRAINT injected_failure CHECK (id < 0) NOT VALID`)
		if _, err = step.fn(ctx, a.ID); err == nil {
			t.Fatal("transition committed without event")
		}
		after, err = p.GetTicket(ctx, a.ID)
		if err != nil || after.Status != step.before {
			t.Fatalf("transition rollback=%+v %v", after, err)
		}
		execSQL(t, ctx, p, `ALTER TABLE ticket_events DROP CONSTRAINT injected_failure`)
		if _, err = step.fn(ctx, a.ID); err != nil {
			t.Fatal(err)
		}
	}
	events(t, ctx, p, a.ID, 4)
}

func TestSprint2UpgradeExistingData(t *testing.T) {
	ctx, p, m := integration(t)
	downTo(t, m, migrationPreSprint2)
	var legacy string
	if err := p.pool.QueryRow(ctx, `INSERT INTO tickets(branch_id,service_id,source,status,idempotency_key,scheduled_at)
 VALUES($1::uuid,$2::uuid,'APPOINTMENT','WAITING','legacy','2020-01-01Z') RETURNING id::text`, demoBranch, parcels).Scan(&legacy); err != nil {
		t.Fatal(err)
	}
	if err := m.Up(); err != nil {
		t.Fatal(err)
	}
	a, err := p.GetTicket(ctx, legacy)
	if err != nil || a.PublicNumber != "Q-000001" || a.Status != domain.TicketStatusScheduled || a.ScheduledAt == nil || !a.QueueEnteredAt.Equal(*a.ScheduledAt) {
		t.Fatalf("legacy=%+v %v", a, err)
	}
	events(t, ctx, p, legacy, 0)
	claimed, err := p.CallNext(ctx, window1)
	if err != nil || claimed.ID != legacy {
		t.Fatalf("legacy claim=%+v %v", claimed, err)
	}
	events(t, ctx, p, legacy, 1)
	for _, sql := range []string{`UPDATE ticket_events SET occurred_at=now()`, `DELETE FROM ticket_events`} {
		if _, err = p.pool.Exec(ctx, sql); err == nil {
			t.Fatal("audit mutation accepted")
		}
	}
	events(t, ctx, p, legacy, 1)
}

func TestCallNextKeepsLoadedPolicy(t *testing.T) {
	ctx, p, _ := integration(t)
	qr := create(t, ctx, p, parcels, "policy-snapshot")
	// Stop precisely at event insertion, after policy selection and ticket update.
	execSQL(t, ctx, p, `CREATE FUNCTION pause_called_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.type='CALLED' THEN PERFORM pg_advisory_xact_lock(9172026,5); END IF; RETURN NEW; END $$`)
	execSQL(t, ctx, p, `CREATE TRIGGER pause_called_event BEFORE INSERT ON ticket_events FOR EACH ROW EXECUTE FUNCTION pause_called_event()`)
	locker, err := p.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer locker.Rollback(context.Background())
	if _, err = locker.Exec(ctx, `SELECT pg_advisory_xact_lock(9172026,5)`); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := p.CallNext(ctx, window1); done <- err }()
	deadline := time.Now().Add(5 * time.Second)
	for {
		var waiting bool
		if err = p.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=9172026 AND objid=5 AND NOT granted)`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("CallNext did not reach event insertion")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if _, err = p.UpdateQueuePolicy(ctx, application.UpdateQueuePolicyCommand{BranchID: demoBranch, AppointmentDuePriority: 300, QRPriority: 30, LivePriority: 10, AntiStarvationThresholdMinutes: 15, AntiStarvationPointsPerMinute: 10, AppointmentGraceMinutes: 15, AppointmentLatePenaltyPerMinute: 5, AppointmentLatePenaltyMaxPoints: 90, ExpectedVersion: 2}); err != nil {
		t.Fatal(err)
	}
	if err = locker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	e := events(t, ctx, p, qr.ID, 2)[1]
	if *e.PolicyVersion != 2 || *e.DecisionPriority != 10 {
		t.Fatalf("mixed policy=%+v", e)
	}
}

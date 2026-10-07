package persistence

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func TestLegacyLiveClaimCompatibility(t *testing.T) {
	ctx, p, _ := integration(t)
	live, err := p.CreateLiveTicket(ctx, application.CreateLiveTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "legacy-live"})
	if err != nil || live.Ticket.Source != domain.TicketSourceLive || live.Ticket.Status != domain.TicketStatusWaiting {
		t.Fatalf("LIVE create: %+v %v", live, err)
	}
	_, err = p.CallNext(ctx, window2)
	wantError(t, err, application.ErrNoEligibleTickets)
	execSQL(t, ctx, p, `UPDATE windows SET status='CLOSED' WHERE id=$1::uuid`, window1)
	_, err = p.CallNext(ctx, window1)
	wantError(t, err, application.ErrInvalidState)
	execSQL(t, ctx, p, `UPDATE windows SET status='OPEN' WHERE id=$1::uuid`, window1)
	// Both compatible windows race for one LIVE ticket using the unchanged locks.
	var results [2]domain.Ticket
	var errs [2]error
	concurrently(2, func(i int) { results[i], errs[i] = p.CallNext(ctx, []string{window1, window3}[i]) })
	count := 0
	for i, err := range errs {
		if err != nil {
			wantError(t, err, application.ErrNoEligibleTickets)
			continue
		}
		count++
		if results[i].ID != live.Ticket.ID || results[i].Status != domain.TicketStatusCalled || results[i].Window == nil {
			t.Fatalf("LIVE claim: %+v", results[i])
		}
	}
	if count != 1 {
		t.Fatalf("LIVE claimed %d times", count)
	}
	// Sprint 3 LIVE emits CREATED; the common CallNext still emits CALLED.
	e := events(t, ctx, p, live.Ticket.ID, 2)[1]
	if e.Type != domain.TicketEventCalled || e.FromStatus == nil || *e.FromStatus != domain.TicketStatusWaiting || e.PolicyVersion == nil || *e.PolicyVersion != 2 || e.DecisionPriority == nil || *e.DecisionPriority != 2 {
		t.Fatalf("LIVE event: %+v", e)
	}
	if _, err = p.StartService(ctx, live.Ticket.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = p.CompleteService(ctx, live.Ticket.ID); err != nil {
		t.Fatal(err)
	}
}

func TestLegacyLiveSharesQRFIFO(t *testing.T) {
	ctx, p, _ := integration(t)
	qr := create(t, ctx, p, parcels, "qr")
	live, err := p.CreateLiveTicket(ctx, application.CreateLiveTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "live"})
	if err != nil {
		t.Fatal(err)
	}
	appointment := book(t, ctx, p, "appointment", parcels).Appointment.Ticket
	due(t, ctx, p, appointment.ID)
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=now()-interval '3 minutes' WHERE id=$1::uuid`, live.Ticket.ID)
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at=now()-interval '2 minutes' WHERE id=$1::uuid`, qr.ID)
	// Due appointment (Tier 0) beats QR (Tier 1) which beats LIVE (Tier 2).
	for _, id := range []string{appointment.ID, qr.ID, live.Ticket.ID} {
		got, err := p.CallNext(ctx, window1)
		if err != nil || got.ID != id {
			t.Fatalf("ordering: %+v %v want=%s", got, err, id)
		}
		if _, err = p.StartService(ctx, id); err != nil {
			t.Fatal(err)
		}
		if _, err = p.CompleteService(ctx, id); err != nil {
			t.Fatal(err)
		}
	}
	// Equal tier and tier_entered_at uses UUID tie-breaker.
	t1 := create(t, ctx, p, parcels, "tie-1")
	t2 := create(t, ctx, p, parcels, "tie-2")
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at='2012-01-01Z', created_at='2012-01-01Z' WHERE id IN ($1::uuid,$2::uuid)`, t1.ID, t2.ID)
	first, second := t1.ID, t2.ID
	if second < first {
		first, second = second, first
	}
	for i, id := range []string{first, second} {
		got, err := p.CallNext(ctx, []string{window1, window3}[i])
		if err != nil || got.ID != id {
			t.Fatalf("tie: %+v %v want=%s", got, err, id)
		}
	}
}

func TestAppointmentNumberAndPendingDownUp(t *testing.T) {
	ctx, p, m := integration(t)
	cmd := application.CreateAppointmentCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "before-down", ScheduledAt: time.Now().Add(time.Hour).Truncate(time.Second).Add(123456100 * time.Nanosecond)}
	first, err := p.CreateAppointment(ctx, cmd)
	if err != nil || first.Appointment.Ticket.PublicNumber != "A-000001" {
		t.Fatalf("first: %+v %v", first, err)
	}
	downTo(t, m, migrationPreSprint2)
	var status string
	var window *string
	if err = p.pool.QueryRow(ctx, `SELECT status,window_id::text FROM tickets WHERE id=$1::uuid`, first.Appointment.Ticket.ID).Scan(&status, &window); err != nil || status != "WAITING" || window != nil {
		t.Fatalf("down pending: %s %v %v", status, window, err)
	}
	// The old engine's candidate and claim statement still operates after down.
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	var claimed string
	err = tx.QueryRow(ctx, `WITH candidate AS (
 SELECT t.id FROM tickets t WHERE t.branch_id=$2::uuid AND t.status='WAITING'
 AND EXISTS(SELECT 1 FROM window_services ws WHERE ws.window_id=$1::uuid AND ws.service_id=t.service_id)
 ORDER BY (t.source='APPOINTMENT') DESC,t.queue_entered_at,t.id FOR UPDATE OF t SKIP LOCKED LIMIT 1
 ) UPDATE tickets t SET status='CALLED',window_id=$1::uuid,called_at=clock_timestamp()
 FROM candidate c WHERE t.id=c.id RETURNING t.id::text`, window1, demoBranch).Scan(&claimed)
	if err != nil || claimed != first.Appointment.Ticket.ID {
		t.Fatalf("legacy claim after down: %s %v", claimed, err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err = m.Up(); err != nil {
		t.Fatal(err)
	}
	restored, err := p.GetTicket(ctx, first.Appointment.Ticket.ID)
	if err != nil || restored.Status != domain.TicketStatusScheduled || restored.Window != nil {
		t.Fatalf("up pending: %+v %v", restored, err)
	}
	second := book(t, ctx, p, "after-up", parcels)
	if second.Appointment.Ticket.PublicNumber != "A-000002" {
		t.Fatal(second.Appointment.Ticket.PublicNumber)
	}
	replay, err := p.CreateAppointment(ctx, cmd)
	if err != nil || !replay.Replayed || replay.Appointment.Ticket.ID != restored.ID {
		t.Fatalf("precision retained across down/up: %+v %v", replay, err)
	}
	cmd.ScheduledAt = cmd.ScheduledAt.Add(800 * time.Nanosecond)
	_, err = p.CreateAppointment(ctx, cmd)
	wantError(t, err, application.ErrIdempotencyConflict)
}

func TestLegacyAssignedAppointmentNormalization(t *testing.T) {
	ctx, p, m := integration(t)
	downTo(t, m, migrationPreSprint2)
	var pending, completed string
	err := p.pool.QueryRow(ctx, `INSERT INTO tickets(branch_id,service_id,source,status,idempotency_key,scheduled_at,window_id,called_at)
 VALUES($1::uuid,$2::uuid,'APPOINTMENT','WAITING','legacy-redirect','2030-01-01Z',$3::uuid,now()) RETURNING id::text`, demoBranch, parcels, window1).Scan(&pending)
	if err != nil {
		t.Fatal(err)
	}
	err = p.pool.QueryRow(ctx, `INSERT INTO tickets(branch_id,service_id,source,status,idempotency_key,scheduled_at,queue_entered_at,window_id,called_at,service_started_at,completed_at)
 VALUES($1::uuid,$2::uuid,'APPOINTMENT','COMPLETED','legacy-completed','2020-01-02Z','2020-01-01Z',$3::uuid,'2020-01-02Z','2020-01-02Z','2020-01-02Z') RETURNING id::text`, demoBranch, parcels, window1).Scan(&completed)
	if err != nil {
		t.Fatal(err)
	}
	var before, after string
	const legacyCols = `(to_jsonb(t)-'arrived_at'-'no_show_at'-'checkin_at'-'ready_at'-'due_at'-'source_rank'-'policy_version'-'recall_count'-'client_id'-'management_token_hash'-'requeued_at'-'sms_reminder_sent'-'confirmed_at'-'confirmation_code'-'notification_email'-'notification_phone'-'confirmation_expires_at'-'confirmation_token_hash')::text`
	if err = p.pool.QueryRow(ctx, `SELECT `+legacyCols+` FROM tickets t WHERE id=$1::uuid`, completed).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err = m.Up(); err != nil {
		t.Fatal(err)
	}
	got, err := p.GetTicket(ctx, pending)
	if err != nil || got.Status != domain.TicketStatusScheduled || got.Window != nil || got.ScheduledAt == nil || !got.QueueEnteredAt.Equal(*got.ScheduledAt) {
		t.Fatalf("normalized: %+v %v", got, err)
	}
	events(t, ctx, p, pending, 0)
	cancelled, err := p.CancelAppointment(WithStaffBypass(ctx), pending)
	if err != nil || cancelled.Ticket.Status != domain.TicketStatusCancelled || cancelled.Ticket.Window != nil {
		t.Fatalf("cancel normalized: %+v %v", cancelled, err)
	}
	events(t, ctx, p, pending, 1)
	if err = p.pool.QueryRow(ctx, `SELECT `+legacyCols+` FROM tickets t WHERE id=$1::uuid`, completed).Scan(&after); err != nil || after != before {
		t.Fatalf("terminal changed on up: %s -> %s (%v)", before, after, err)
	}
	downTo(t, m, migrationPreSprint2)
	if err = p.pool.QueryRow(ctx, `SELECT `+legacyCols+` FROM tickets t WHERE id=$1::uuid`, completed).Scan(&after); err != nil || after != before {
		t.Fatalf("terminal changed on down: %s -> %s (%v)", before, after, err)
	}
}

func TestAppointmentExactInstantIdempotency(t *testing.T) {
	ctx, p, _ := integration(t)
	instant := time.Now().Add(time.Hour).Truncate(time.Second).Add(123456100 * time.Nanosecond)
	cmd := application.CreateAppointmentCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "precise", ScheduledAt: instant}
	var results [8]application.CreateAppointmentResult
	var errs [8]error
	concurrently(8, func(i int) { results[i], errs[i] = p.CreateAppointment(ctx, cmd) })
	created := 0
	for i, r := range results {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if !r.Replayed {
			created++
		}
		if r.Appointment.Ticket.ID != results[0].Appointment.Ticket.ID {
			t.Fatal("duplicate precise ticket")
		}
	}
	if created != 1 {
		t.Fatalf("created=%d", created)
	}
	id := results[0].Appointment.Ticket.ID
	events(t, ctx, p, id, 1)
	var stored string
	if err := p.pool.QueryRow(ctx, `SELECT appointment_requested_at FROM tickets WHERE id=$1::uuid`, id).Scan(&stored); err != nil || stored != instant.UTC().Format(time.RFC3339Nano) {
		t.Fatalf("durable instant: %s %v", stored, err)
	}
	// A fresh pool/core instance must replay from persisted metadata, not memory.
	freshPool, err := pgxpool.NewWithConfig(ctx, p.pool.Config())
	if err != nil {
		t.Fatal(err)
	}
	defer freshPool.Close()
	fresh := New(freshPool)
	for _, same := range []time.Time{instant, instant.In(time.FixedZone("offset", 9*3600))} {
		cmd.ScheduledAt = same
		r, err := fresh.CreateAppointment(ctx, cmd)
		if err != nil || !r.Replayed || r.Appointment.Ticket.ID != id {
			t.Fatalf("precise replay: %+v %v", r, err)
		}
	}
	cmd.ScheduledAt = instant.Add(800 * time.Nanosecond)
	if !cmd.ScheduledAt.Truncate(time.Microsecond).Equal(instant.Truncate(time.Microsecond)) {
		t.Fatal("fixture does not collapse to same PostgreSQL timestamp")
	}
	_, err = fresh.CreateAppointment(ctx, cmd)
	wantError(t, err, application.ErrIdempotencyConflict)
	events(t, ctx, p, id, 1)
	// The conflict also holds when two distinct precise instants race for a new key.
	cmd.IdempotencyKey = "precise-conflict"
	var raceErr [2]error
	concurrently(2, func(i int) {
		c := cmd
		c.ScheduledAt = instant.Add(time.Duration(i) * 800 * time.Nanosecond)
		_, raceErr[i] = fresh.CreateAppointment(ctx, c)
	})
	successes := 0
	for _, err := range raceErr {
		if err == nil {
			successes++
		} else {
			wantError(t, err, application.ErrIdempotencyConflict)
		}
	}
	if successes != 1 {
		t.Fatalf("distinct instant successes=%d", successes)
	}
}

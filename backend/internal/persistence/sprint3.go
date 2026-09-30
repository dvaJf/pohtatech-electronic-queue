package persistence

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func (p *Postgres) CreateLiveTicket(ctx context.Context, c application.CreateLiveTicketCommand) (application.CreateLiveTicketResult, error) {
	var empty application.CreateLiveTicketResult
	b, err := uuid(c.BranchID)
	if err != nil {
		return empty, err
	}
	s, err := uuid(c.ServiceID)
	if err != nil {
		return empty, err
	}
	if strings.TrimSpace(c.IdempotencyKey) == "" {
		return empty, application.ErrInvalidState
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(context.Background())
	// Serialize same-key LIVE/Appointment requests before allocating a number.
	// The shared unique key handles races with QR as well.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, c.IdempotencyKey); err != nil {
		return empty, dbError(err)
	}
	replay := func(t domain.Ticket) (application.CreateLiveTicketResult, error) {
		tb, _ := uuid(t.BranchID)
		ts, _ := uuid(t.ServiceID)
		if t.Source != domain.TicketSourceLive || tb != b || ts != s {
			return empty, application.ErrIdempotencyConflict
		}
		rawToken, _ := DeterministicManagementToken(c.IdempotencyKey)
		t.ManagementToken = &rawToken
		return application.CreateLiveTicketResult{Ticket: t, Replayed: true}, nil
	}
	existing, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.idempotency_key=$1`, c.IdempotencyKey))
	if err == nil {
		return replay(existing)
	}
	if !errors.Is(err, application.ErrNotFound) {
		return empty, err
	}
	var enabled bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM branch_services WHERE branch_id=$1 AND service_id=$2)`, b, s).Scan(&enabled); err != nil {
		return empty, dbError(err)
	}
	if !enabled {
		return empty, application.ErrNotFound
	}
	var tid string
	now := time.Now().UTC()
	policy := p.getBranchPolicyTx(ctx, tx, b)
	dueAt, readyAt, sourceRank := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{
		Source:    domain.TicketSourceLive,
		ServiceID: c.ServiceID,
	}, now)

	rawToken, tokenHash := DeterministicManagementToken(c.IdempotencyKey)
	err = tx.QueryRow(ctx, `INSERT INTO tickets(branch_id,service_id,source,status,idempotency_key,public_number,created_at,queue_entered_at,checkin_at,ready_at,due_at,source_rank,policy_version,management_token_hash,client_id)
 VALUES($1,$2,'LIVE','WAITING',$3,next_live_public_number(),$4,$4,$4,$5,$6,$7,$8,$9,$10)
 ON CONFLICT(idempotency_key) DO NOTHING RETURNING id::text`, b, s, c.IdempotencyKey, now, readyAt, dueAt, sourceRank, policy.PolicyVersion, tokenHash, c.ClientID).Scan(&tid)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, err = scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.idempotency_key=$1`, c.IdempotencyKey))
		if err != nil {
			return empty, err
		}
		return replay(existing)
	}
	if err != nil {
		return empty, dbError(err)
	}
	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1::uuid`, tid))
	if err != nil {
		return empty, err
	}
	t.ManagementToken = &rawToken
	if err = insertEvent(ctx, tx, t, domain.TicketEventCreated, nil, nil, nil, EventExtra{
		Actor:  "kiosk_live",
		Reason: "ticket created",
		DueAt:  t.DueAt,
		At:     &now,
	}); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}
	return application.CreateLiveTicketResult{Ticket: t}, nil
}

func (p *Postgres) ArriveAppointment(ctx context.Context, ticketID string) (application.AppointmentView, error) {
	var empty application.AppointmentView
	id, err := uuid(ticketID)
	tx, errTx := p.pool.Begin(ctx)
	if errTx != nil {
		return empty, dbError(errTx)
	}
	defer tx.Rollback(context.Background())

	var row pgx.Row
	if err == nil {
		row = tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1 FOR UPDATE OF t`, id)
	} else {
		row = tx.QueryRow(ctx, ticketSelect+`WHERE (UPPER(t.public_number)=UPPER($1) OR UPPER(t.public_number)=UPPER('A-' || $1) OR UPPER(t.public_number)=UPPER('A-' || LPAD($1, 6, '0'))) FOR UPDATE OF t`, strings.TrimSpace(ticketID))
	}
	t, err := scanTicket(row)
	if err != nil {
		return empty, err
	}
	if t.Source != domain.TicketSourceAppointment || t.Status != domain.TicketStatusScheduled {
		return empty, application.ErrInvalidState
	}
	if t.ArrivedAt != nil {
		return appointmentView(t), nil
	}
	checkin := time.Now().UTC()
	bId, _ := uuid(t.BranchID)
	policy := p.getBranchPolicyTx(ctx, tx, bId)
	dueAt, readyAt, sourceRank := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{
		Source:      t.Source,
		ScheduledAt: t.ScheduledAt,
		ServiceID:   t.ServiceID,
	}, checkin)

	targetID, err := uuid(t.ID)
	if err != nil {
		return empty, err
	}

	if err = tx.QueryRow(ctx, `UPDATE tickets
		SET arrived_at=$2, checkin_at=$2, due_at=$3, ready_at=$4, source_rank=$5, policy_version=$6
		WHERE id=$1 RETURNING arrived_at`, targetID, checkin, dueAt, readyAt, sourceRank, policy.PolicyVersion).Scan(&t.ArrivedAt); err != nil {
		return empty, dbError(err)
	}
	*t.ArrivedAt = t.ArrivedAt.UTC()
	t.CheckinAt = t.ArrivedAt
	t.DueAt = &dueAt
	t.ReadyAt = &readyAt
	t.SourceRank = sourceRank
	t.PolicyVersion = policy.PolicyVersion

	extra := EventExtra{
		Actor:  "client_checkin",
		Reason: "appointment arrived",
		DueAt:  &dueAt,
		At:     &checkin,
	}
	if err = insertEvent(ctx, tx, t, domain.TicketEventArrived, &t.Status, nil, nil, extra); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}
	return appointmentView(t), nil
}

func (p *Postgres) MarkNoShow(ctx context.Context, ticketID string) (domain.Ticket, error) {
	var empty domain.Ticket
	id, err := uuid(ticketID)
	if err != nil {
		return empty, err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(context.Background())
	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1 FOR UPDATE OF t`, id))
	if err != nil {
		return empty, err
	}
	if t.Status == domain.TicketStatusNoShow {
		return t, nil
	}
	if t.Status != domain.TicketStatusCalled {
		return empty, application.ErrInvalidState
	}
	from := t.Status
	if err = tx.QueryRow(ctx, `UPDATE tickets SET status='NO_SHOW',no_show_at=transaction_timestamp() WHERE id=$1 RETURNING no_show_at`, id).Scan(&t.NoShowAt); err != nil {
		return empty, dbError(err)
	}
	*t.NoShowAt = t.NoShowAt.UTC()
	t.Status = domain.TicketStatusNoShow
	extra := EventExtra{
		Actor:  "operator",
		Reason: "client no show",
		DueAt:  t.DueAt,
	}
	if err = insertEvent(ctx, tx, t, domain.TicketEventNoShow, &from, nil, nil, extra); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}
	return t, nil
}

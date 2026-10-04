package persistence

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func appointmentView(t domain.Ticket) application.AppointmentView {
	return application.AppointmentView{Ticket: t, ScheduledAt: *t.ScheduledAt}
}

func (p *Postgres) CreateAppointment(ctx context.Context, cmd application.CreateAppointmentCommand) (application.CreateAppointmentResult, error) {
	var empty application.CreateAppointmentResult
	b, err := uuid(cmd.BranchID)
	if err != nil {
		return empty, err
	}
	s, err := uuid(cmd.ServiceID)
	if err != nil {
		return empty, err
	}
	if strings.TrimSpace(cmd.IdempotencyKey) == "" || cmd.ScheduledAt.IsZero() {
		return empty, application.ErrInvalidState
	}
	// Keep the exact logical input separately from PostgreSQL timestamp precision.
	requestedInstant := cmd.ScheduledAt.UTC().Format(time.RFC3339Nano)
	scheduled := cmd.ScheduledAt.UTC().Truncate(time.Microsecond)
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(context.Background())
	// Serialize appointment creators before allocating a public number. The unique
	// ticket key remains the authority, including races with existing QR creation.
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, cmd.IdempotencyKey); err != nil {
		return empty, dbError(err)
	}
	replayExisting := func(t domain.Ticket) (application.CreateAppointmentResult, error) {
		tb, _ := uuid(t.BranchID)
		ts, _ := uuid(t.ServiceID)
		if tb != b || ts != s || t.Source != domain.TicketSourceAppointment || t.ScheduledAt == nil {
			return empty, application.ErrIdempotencyConflict
		}
		var storedInstant *string
		if err := tx.QueryRow(ctx, `SELECT appointment_requested_at FROM tickets WHERE id=$1::uuid`, t.ID).Scan(&storedInstant); err != nil {
			return empty, dbError(err)
		}
		// Pre-000005 tickets have no original input metadata: only the stored instant
		// is known. Never infer discarded nanoseconds for those historical requests.
		matches := t.ScheduledAt.Equal(cmd.ScheduledAt)
		if storedInstant != nil {
			matches = *storedInstant == requestedInstant
		}
		if !matches {
			return empty, application.ErrIdempotencyConflict
		}
		rawToken, _ := DeterministicManagementToken(cmd.IdempotencyKey)
		t.ManagementToken = &rawToken
		return application.CreateAppointmentResult{Appointment: appointmentView(t), Replayed: true}, nil
	}
	existing, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.idempotency_key=$1`, cmd.IdempotencyKey))
	if err == nil {
		return replayExisting(existing)
	}
	if !errors.Is(err, application.ErrNotFound) {
		return empty, err
	}
	var enabled, future bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM branch_services WHERE branch_id=$1 AND service_id=$2), $3::timestamptz > clock_timestamp()`, b, s, scheduled).Scan(&enabled, &future)
	if err != nil {
		return empty, dbError(err)
	}
	if !enabled {
		return empty, application.ErrNotFound
	}
	if !future {
		return empty, application.ErrInvalidState
	}
	policy := p.getBranchPolicyTx(ctx, tx, b)
	dueAt, readyAt, sourceRank := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{
		Source:      domain.TicketSourceAppointment,
		ScheduledAt: &scheduled,
		ServiceID:   cmd.ServiceID,
	}, time.Time{})

	var tid string
	rawToken, tokenHash := DeterministicManagementToken(cmd.IdempotencyKey)
	initialStatus := domain.TicketStatusScheduled
	var confToken, confTokenHash, confCode, notifEmail, notifPhone *string
	var confExpiresAt *time.Time

	cleanEmail := strings.TrimSpace(strings.ToLower(cmd.NotificationEmail))
	cleanPhone := strings.TrimSpace(cmd.NotificationPhone)
	if cleanEmail != "" {
		notifEmail = &cleanEmail
	}
	if cleanPhone != "" {
		notifPhone = &cleanPhone
	}

	if cleanEmail != "" {
		initialStatus = domain.TicketStatusPendingConfirmation
		token, hash, err := notificationToken()
		if err != nil {
			return empty, err
		}
		confToken = &token
		confTokenHash = &hash
		codeNum := (time.Now().UnixNano() % 900000) + 100000
		if codeNum < 100000 {
			codeNum += 100000
		}
		cStr := fmt.Sprintf("%06d", codeNum)
		confCode = &cStr
		exp := time.Now().UTC().Add(15 * time.Minute)
		confExpiresAt = &exp
	}

	err = tx.QueryRow(ctx, `INSERT INTO tickets(branch_id,service_id,source,status,idempotency_key,scheduled_at,queue_entered_at,public_number,appointment_requested_at,ready_at,due_at,source_rank,policy_version,management_token_hash,client_id,confirmation_token_hash,confirmation_code,confirmation_expires_at,notification_email,notification_phone)
 VALUES($1,$2,'APPOINTMENT',$3,$4,$5,$5,next_appointment_public_number(),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
 ON CONFLICT(idempotency_key) DO NOTHING RETURNING id::text`, b, s, string(initialStatus), cmd.IdempotencyKey, scheduled, requestedInstant, readyAt, dueAt, sourceRank, policy.PolicyVersion, tokenHash, cmd.ClientID, confTokenHash, confCode, confExpiresAt, notifEmail, notifPhone).Scan(&tid)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, err = scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.idempotency_key=$1`, cmd.IdempotencyKey))
		if err != nil {
			return empty, err
		}
		return replayExisting(existing)
	}
	if err != nil {
		return empty, dbError(err)
	}
	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1::uuid`, tid))
	if err != nil {
		return empty, err
	}
	t.ManagementToken = &rawToken
	if confToken != nil {
		t.ConfirmationTokenHash = confToken // Pass unhashed token in-memory for immediate email dispatch
	}
	if confCode != nil {
		t.ConfirmationCode = confCode
	}
	if confExpiresAt != nil {
		t.ConfirmationExpiresAt = confExpiresAt
	}

	if err = insertEvent(ctx, tx, t, domain.TicketEventCreated, nil, nil, nil, EventExtra{
		Actor:  "client_online",
		Reason: "appointment requested",
		DueAt:  t.DueAt,
	}); err != nil {
		return empty, err
	}

	if initialStatus == domain.TicketStatusScheduled {
		if err = p.enqueueAppointmentNotificationsTx(ctx, tx, t.ID, cmd.ScheduledAt, cmd.NotificationEmail, cmd.NotificationPhone); err != nil {
			return empty, err
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}
	return application.CreateAppointmentResult{Appointment: appointmentView(t)}, nil
}

func (p *Postgres) ConfirmAppointment(ctx context.Context, ticketID, tokenOrCode string) (application.AppointmentView, error) {
	var empty application.AppointmentView
	id, err := uuid(ticketID)
	if err != nil {
		return empty, err
	}
	cleanInput := strings.TrimSpace(tokenOrCode)
	if cleanInput == "" {
		return empty, application.ErrInvalidState
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
	if t.Source != domain.TicketSourceAppointment {
		return empty, application.ErrInvalidState
	}

	if t.Status == domain.TicketStatusScheduled {
		return appointmentView(t), nil
	}
	if t.Status != domain.TicketStatusPendingConfirmation {
		return empty, application.ErrInvalidState
	}

	if t.ConfirmationExpiresAt != nil && t.ConfirmationExpiresAt.Before(time.Now().UTC()) {
		_, _ = tx.Exec(ctx, `UPDATE tickets SET status='CANCELLED' WHERE id=$1`, id)
		_ = insertEvent(ctx, tx, t, domain.TicketEventCancelled, nil, nil, nil, EventExtra{
			Actor:  "system_reconciler",
			Reason: "confirmation expired after 15 minutes",
		})
		_ = tx.Commit(ctx)
		return empty, application.ErrInvalidState
	}

	var storedHash, storedCode, notifEmail, notifPhone *string
	err = tx.QueryRow(ctx, `SELECT confirmation_token_hash, confirmation_code, notification_email, notification_phone FROM tickets WHERE id=$1`, id).Scan(&storedHash, &storedCode, &notifEmail, &notifPhone)
	if err != nil {
		return empty, dbError(err)
	}

	matched := false
	if storedCode != nil && *storedCode != "" && subtle.ConstantTimeCompare([]byte(cleanInput), []byte(*storedCode)) == 1 {
		matched = true
	}
	if !matched && storedHash != nil && *storedHash != "" {
		inputSum := sha256.Sum256([]byte(cleanInput))
		hexHash := hex.EncodeToString(inputSum[:])
		if subtle.ConstantTimeCompare([]byte(hexHash), []byte(*storedHash)) == 1 {
			matched = true
		}
	}

	if !matched {
		return empty, application.ErrForbidden
	}

	fromStatus := t.Status
	now := time.Now().UTC()
	_, err = tx.Exec(ctx, `UPDATE tickets SET status='SCHEDULED', confirmed_at=$1 WHERE id=$2`, now, id)
	if err != nil {
		return empty, dbError(err)
	}

	t.Status = domain.TicketStatusScheduled
	t.ConfirmedAt = &now

	if err = insertEvent(ctx, tx, t, domain.TicketEventCreated, &fromStatus, nil, nil, EventExtra{
		Actor:  "client_online",
		Reason: "appointment confirmed via email",
		DueAt:  t.DueAt,
	}); err != nil {
		return empty, err
	}

	emailStr := ""
	phoneStr := ""
	if notifEmail != nil {
		emailStr = *notifEmail
	}
	if notifPhone != nil {
		phoneStr = *notifPhone
	}
	if err = p.enqueueAppointmentNotificationsTx(ctx, tx, t.ID, *t.ScheduledAt, emailStr, phoneStr); err != nil {
		return empty, err
	}

	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}
	return appointmentView(t), nil
}

func (p *Postgres) ResendAppointmentConfirmation(ctx context.Context, ticketID string) (token, code string, expiresAt time.Time, err error) {
	id, err := uuid(ticketID)
	if err != nil {
		return "", "", time.Time{}, err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return "", "", time.Time{}, dbError(err)
	}
	defer tx.Rollback(context.Background())

	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1 FOR UPDATE OF t`, id))
	if err != nil {
		return "", "", time.Time{}, err
	}
	if t.Status != domain.TicketStatusPendingConfirmation {
		return "", "", time.Time{}, application.ErrInvalidState
	}

	token, hash, err := notificationToken()
	if err != nil {
		return "", "", time.Time{}, err
	}
	codeNum := (time.Now().UnixNano() % 900000) + 100000
	if codeNum < 100000 {
		codeNum += 100000
	}
	code = fmt.Sprintf("%06d", codeNum)
	expiresAt = time.Now().UTC().Add(15 * time.Minute)

	_, err = tx.Exec(ctx, `UPDATE tickets SET confirmation_token_hash=$1, confirmation_code=$2, confirmation_expires_at=$3 WHERE id=$4`, hash, code, expiresAt, id)
	if err != nil {
		return "", "", time.Time{}, dbError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return "", "", time.Time{}, dbError(err)
	}
	return token, code, expiresAt, nil
}

func (p *Postgres) ExpirePendingAppointments(ctx context.Context, cutoff time.Time) (int64, error) {
	tag, err := p.pool.Exec(ctx, `UPDATE tickets SET status='CANCELLED' WHERE status='PENDING_CONFIRMATION' AND confirmation_expires_at <= $1::timestamptz`, cutoff)
	if err != nil {
		return 0, dbError(err)
	}
	return tag.RowsAffected(), nil
}

func (p *Postgres) CancelAppointment(ctx context.Context, ticketID string) (application.AppointmentView, error) {
	var empty application.AppointmentView
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
	if t.Source != domain.TicketSourceAppointment {
		return empty, application.ErrInvalidState
	}

	var storedHash *string
	_ = tx.QueryRow(ctx, `SELECT management_token_hash FROM tickets WHERE id=$1`, id).Scan(&storedHash)
	if !IsStaffBypass(ctx) {
		token, hasToken := ManagementTokenFromContext(ctx)
		ownerID, hasOwner := ClientOwnerFromContext(ctx)
		isOwner := hasOwner && t.ClientID != nil && *t.ClientID == ownerID

		if !isOwner {
			if !hasToken || token == "" || storedHash == nil || *storedHash == "" {
				return empty, application.ErrForbidden
			}
			computed := HashManagementToken(token)
			if subtle.ConstantTimeCompare([]byte(*storedHash), []byte(computed)) != 1 {
				return empty, application.ErrForbidden
			}
		}
	}

	if t.Status == domain.TicketStatusCancelled {
		return appointmentView(t), nil
	}
	if t.Status != domain.TicketStatusScheduled {
		return empty, application.ErrInvalidState
	}
	from := t.Status
	if _, err = tx.Exec(ctx, `UPDATE tickets SET status='CANCELLED' WHERE id=$1`, id); err != nil {
		return empty, dbError(err)
	}
	t.Status = domain.TicketStatusCancelled
	if err = insertEvent(ctx, tx, t, domain.TicketEventCancelled, &from, nil, nil); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}
	return appointmentView(t), nil
}

func (p *Postgres) CancelTicket(ctx context.Context, ticketID string) (domain.Ticket, error) {
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

	var storedHash *string
	_ = tx.QueryRow(ctx, `SELECT management_token_hash FROM tickets WHERE id=$1`, id).Scan(&storedHash)
	if !IsStaffBypass(ctx) {
		token, hasToken := ManagementTokenFromContext(ctx)
		ownerID, hasOwner := ClientOwnerFromContext(ctx)
		isOwner := hasOwner && t.ClientID != nil && *t.ClientID == ownerID

		if !isOwner {
			if !hasToken || token == "" || storedHash == nil || *storedHash == "" {
				return empty, application.ErrForbidden
			}
			computed := HashManagementToken(token)
			if subtle.ConstantTimeCompare([]byte(*storedHash), []byte(computed)) != 1 {
				return empty, application.ErrForbidden
			}
		}
	}
	if t.Status == domain.TicketStatusCancelled {
		return t, nil
	}
	if t.Status != domain.TicketStatusWaiting && t.Status != domain.TicketStatusScheduled {
		return empty, application.ErrInvalidState
	}
	from := t.Status
	if _, err = tx.Exec(ctx, `UPDATE tickets SET status='CANCELLED' WHERE id=$1`, id); err != nil {
		return empty, dbError(err)
	}
	t.Status = domain.TicketStatusCancelled
	if err = insertEvent(ctx, tx, t, domain.TicketEventCancelled, &from, nil, nil); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}
	return t, nil
}

type EventExtra struct {
	Actor     string
	Reason    string
	DueAt     *time.Time
	RequestID string
	At        *time.Time
}

func insertEvent(ctx context.Context, tx pgx.Tx, t domain.Ticket, kind domain.TicketEventType, from *domain.TicketStatus, version *int64, priority *int64, extra ...EventExtra) error {
	var fromStatus domain.TicketStatus
	if from != nil {
		fromStatus = *from
	}
	// FSM state transition validation (bypassed for policy recalculation audit records)
	if kind != domain.TicketEventQueueRecalculated {
		if err := domain.ValidateTransition(fromStatus, t.Status); err != nil {
			return err
		}
	}

	var window *string
	if t.Window != nil {
		window = &t.Window.ID
	}
	var occurred *time.Time
	switch kind {
	case domain.TicketEventArrived:
		occurred = t.ArrivedAt
	case domain.TicketEventNoShow:
		occurred = t.NoShowAt
	case domain.TicketEventCreated:
		occurred = &t.CreatedAt
	case domain.TicketEventCalled:
		occurred = t.CalledAt
	case domain.TicketEventServiceStarted:
		occurred = t.ServiceStartedAt
	case domain.TicketEventCompleted:
		occurred = t.CompletedAt
	}

	var actor, reason, requestID *string
	var dueAt, at *time.Time
	if len(extra) > 0 {
		if extra[0].Actor != "" {
			actor = &extra[0].Actor
		}
		if extra[0].Reason != "" {
			reason = &extra[0].Reason
		}
		dueAt = extra[0].DueAt
		if extra[0].RequestID != "" {
			requestID = &extra[0].RequestID
		}
		at = extra[0].At
	}
	if dueAt == nil {
		dueAt = t.DueAt
	}
	if at == nil {
		at = occurred
	}

	_, err := tx.Exec(ctx, `INSERT INTO ticket_events(ticket_id,type,from_status,to_status,window_id,policy_version,decision_priority,occurred_at,actor,reason,due_at,request_id,at)
 VALUES($1::uuid,$2,$3,$4,$5::uuid,$6,$7,COALESCE($8::timestamptz,clock_timestamp()),$9,$10,$11,$12,COALESCE($13::timestamptz,clock_timestamp()))`,
		t.ID, kind, from, t.Status, window, version, priority, occurred, actor, reason, dueAt, requestID, at)
	return dbError(err)
}

func (p *Postgres) ListTicketEvents(ctx context.Context, ticketID string) ([]domain.TicketEvent, error) {
	if _, err := p.GetTicket(ctx, ticketID); err != nil {
		return nil, err
	}
	rows, err := p.pool.Query(ctx, `SELECT id,ticket_id::text,type,from_status,to_status,window_id::text,policy_version,decision_priority,occurred_at,actor,reason,due_at,request_id,at
 FROM ticket_events WHERE ticket_id=$1::uuid ORDER BY occurred_at,id`, ticketID)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()
	out := []domain.TicketEvent{}
	for rows.Next() {
		var e domain.TicketEvent
		if err = rows.Scan(&e.ID, &e.TicketID, &e.Type, &e.FromStatus, &e.ToStatus, &e.WindowID, &e.PolicyVersion, &e.DecisionPriority, &e.OccurredAt, &e.Actor, &e.Reason, &e.DueAt, &e.RequestID, &e.At); err != nil {
			return nil, dbError(err)
		}
		e.OccurredAt = e.OccurredAt.UTC()
		if e.DueAt != nil {
			*e.DueAt = e.DueAt.UTC()
		}
		if e.At != nil {
			*e.At = e.At.UTC()
		}
		out = append(out, e)
	}
	return out, dbError(rows.Err())
}

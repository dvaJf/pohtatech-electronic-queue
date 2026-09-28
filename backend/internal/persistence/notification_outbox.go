package persistence

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"postcode/backend/internal/domain"
)

// enqueueCallNotification writes an outbox record inside the active CallNext transaction.
// Any error is non-fatal to the queue transaction and is returned for logging.
func (p *Postgres) enqueueCallNotification(ctx context.Context, tx pgx.Tx, t domain.Ticket) error {
	winNumber := 0
	if t.Window != nil {
		winNumber = t.Window.Number
	}

	occurrence := t.ID
	if t.CalledAt != nil {
		occurrence += ":" + t.CalledAt.UTC().Format(time.RFC3339Nano)
	}
	return p.enqueueChannelDeliveries(ctx, tx, t, domain.NotificationTicketCalled, occurrence, winNumber, 0)
}

// enqueueChannelDeliveries is intentionally called from the existing queue transaction.
// It fans one business occurrence out to active recipients without any network operation.
func (p *Postgres) enqueueChannelDeliveries(ctx context.Context, tx pgx.Tx, t domain.Ticket, event domain.NotificationEventType, occurrence string, windowNumber, ahead int) error {
	type recipient struct{ id, channel, destination string }
	rows, err := tx.Query(ctx, `SELECT id::text,channel,destination FROM notification_subscriptions WHERE ticket_id=$1::uuid AND enabled=true`, t.ID)
	if err != nil {
		return dbError(err)
	}
	var recipients []recipient
	for rows.Next() {
		var r recipient
		if err := rows.Scan(&r.id, &r.channel, &r.destination); err != nil {
			rows.Close()
			return dbError(err)
		}
		recipients = append(recipients, r)
	}
	rows.Close()
	// Retain the prior demo delivery for tickets created before a client selects a channel.
	if len(recipients) == 0 {
		recipients = []recipient{{id: "legacy", channel: string(domain.NotificationChannelDemo)}}
	}
	for _, r := range recipients {
		key := fmt.Sprintf("%s:%s:%s:%s", event, occurrence, r.channel, r.id)
		var id string
		err := tx.QueryRow(ctx, `INSERT INTO notification_outbox(ticket_id,branch_id,event_type,channel,subscription_id,destination,dedupe_key,payload,status,available_at,next_attempt_at,created_at) VALUES($1::uuid,$2::uuid,$3,$4,NULLIF($5,'legacy')::uuid,NULLIF($6,''),$7,'{}'::jsonb,'PENDING',clock_timestamp(),clock_timestamp(),clock_timestamp()) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id::text`, t.ID, t.BranchID, string(event), r.channel, r.id, r.destination, key).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		}
		if err != nil {
			return dbError(err)
		}
		msg := domain.NotificationMessage{ID: id, TicketID: t.ID, BranchID: t.BranchID, PublicNumber: t.PublicNumber, WindowNumber: windowNumber, EventType: event, Channel: domain.NotificationChannel(r.channel), Destination: r.destination, CreatedAt: time.Now().UTC()}
		if event == domain.NotificationTicketNearTurn {
			msg.Body = fmt.Sprintf("Перед вами осталось %d человека. Пора заходить в отделение.", ahead)
		}
		if event == domain.NotificationTicketCalled {
			msg.Body = fmt.Sprintf("Талон %s вызван к окну №%d.", t.PublicNumber, windowNumber)
		}
		payload, err := json.Marshal(msg)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, `UPDATE notification_outbox SET payload=$1::jsonb WHERE id=$2::uuid`, payload, id); err != nil {
			return dbError(err)
		}
	}
	return nil
}

// FetchPendingNotifications atomically claims unassigned/due outbox items with a lease.
func (p *Postgres) FetchPendingNotifications(ctx context.Context, limit int, now time.Time) ([]domain.NotificationOutboxItem, error) {
	if limit <= 0 {
		limit = 10
	}

	rows, err := p.pool.Query(ctx, `
		WITH claimable AS (
			SELECT id
			FROM notification_outbox
			WHERE status = 'PENDING' AND available_at <= $1::timestamptz AND next_attempt_at <= $1::timestamptz
			ORDER BY next_attempt_at ASC, id ASC
			LIMIT $2
			FOR UPDATE SKIP LOCKED
		)
		UPDATE notification_outbox o
		SET next_attempt_at = $1::timestamptz + interval '30 seconds', claimed_until = $1::timestamptz + interval '30 seconds'
		FROM claimable
		WHERE o.id = claimable.id
		RETURNING o.id::text, o.ticket_id::text, o.branch_id::text, o.event_type, o.payload::text,
		          o.status, o.attempts, o.max_attempts, o.next_attempt_at, o.created_at, o.sent_at, o.last_error, o.channel, o.subscription_id::text, o.destination, o.available_at
	`, now, limit)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()

	var items []domain.NotificationOutboxItem
	for rows.Next() {
		var item domain.NotificationOutboxItem
		var evType string
		var status string
		var sentAt *time.Time
		var lastErr *string
		var subscriptionID *string
		var destination *string
		var channel string

		if err := rows.Scan(
			&item.ID,
			&item.TicketID,
			&item.BranchID,
			&evType,
			&item.Payload,
			&status,
			&item.Attempts,
			&item.MaxAttempts,
			&item.NextAttemptAt,
			&item.CreatedAt,
			&sentAt,
			&lastErr,
			&channel, &subscriptionID, &destination, &item.AvailableAt,
		); err != nil {
			return nil, dbError(err)
		}
		item.EventType = domain.NotificationEventType(evType)
		item.Status = domain.NotificationStatus(status)
		item.SentAt = sentAt
		item.LastError = lastErr
		item.Channel = domain.NotificationChannel(channel)
		item.SubscriptionID = subscriptionID
		if destination != nil {
			item.Destination = *destination
		}
		items = append(items, item)
	}
	return items, nil
}

// MarkNotificationSent records successful delivery.
func (p *Postgres) MarkNotificationSent(ctx context.Context, id string, sentAt time.Time) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE notification_outbox
		SET status = 'SENT', sent_at = $1::timestamptz, attempts = attempts + 1, claimed_until=NULL
		WHERE id = $2::uuid
	`, sentAt, id)
	if err != nil {
		return dbError(err)
	}
	return nil
}

// MarkNotificationFailed records transient or permanent delivery failure.
func (p *Postgres) MarkNotificationFailed(ctx context.Context, id string, errStr string, nextAttempt time.Time, final bool) error {
	newStatus := "PENDING"
	if final {
		newStatus = "FAILED"
	}
	_, err := p.pool.Exec(ctx, `
		UPDATE notification_outbox
		SET status = $1, attempts = attempts + 1, last_error = $2, next_attempt_at = $3::timestamptz, claimed_until=NULL
		WHERE id = $4::uuid
	`, newStatus, errStr, nextAttempt, id)
	if err != nil {
		return dbError(err)
	}
	return nil
}

// ListNotificationOutbox provides read access to the outbox for monitoring and debug endpoints.
func (p *Postgres) ListNotificationOutbox(ctx context.Context, limit, offset int, status string) ([]domain.NotificationOutboxItem, int, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}

	whereClause := "WHERE 1=1"
	args := []any{}
	if status != "" {
		args = append(args, status)
		whereClause += fmt.Sprintf(" AND status = $%d", len(args))
	}

	var total int
	countQuery := fmt.Sprintf("SELECT COUNT(*) FROM notification_outbox %s", whereClause)
	if err := p.pool.QueryRow(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, dbError(err)
	}

	args = append(args, limit, offset)
	selectQuery := fmt.Sprintf(`
		SELECT id::text, ticket_id::text, branch_id::text, event_type, payload::text,
		       status, attempts, max_attempts, next_attempt_at, created_at, sent_at, last_error
		FROM notification_outbox
		%s
		ORDER BY created_at DESC, id DESC
		LIMIT $%d OFFSET $%d
	`, whereClause, len(args)-1, len(args))

	rows, err := p.pool.Query(ctx, selectQuery, args...)
	if err != nil {
		return nil, 0, dbError(err)
	}
	defer rows.Close()

	var items []domain.NotificationOutboxItem
	for rows.Next() {
		var item domain.NotificationOutboxItem
		var evType string
		var stat string
		var sentAt *time.Time
		var lastErr *string

		if err := rows.Scan(
			&item.ID,
			&item.TicketID,
			&item.BranchID,
			&evType,
			&item.Payload,
			&stat,
			&item.Attempts,
			&item.MaxAttempts,
			&item.NextAttemptAt,
			&item.CreatedAt,
			&sentAt,
			&lastErr,
		); err != nil {
			return nil, 0, dbError(err)
		}
		item.EventType = domain.NotificationEventType(evType)
		item.Status = domain.NotificationStatus(stat)
		item.SentAt = sentAt
		item.LastError = lastErr
		items = append(items, item)
	}
	return items, total, nil
}

// enqueueNearTurnForTopCandidates finds true top 2 candidates in canonical ranked queue
// with an open compatible window, and idempotently enqueues near-turn notifications.
func (p *Postgres) enqueueNearTurnForTopCandidates(ctx context.Context, tx pgx.Tx, branch string, decisionTime time.Time) error {
	var commit func() error
	var rollback func()
	activeTx := tx

	if activeTx == nil {
		subTx, err := p.pool.Begin(ctx)
		if err != nil {
			return err
		}
		activeTx = subTx
		_, _ = subTx.Exec(ctx, `SET LOCAL lock_timeout = '100ms'`)
		commit = func() error { return subTx.Commit(ctx) }
		rollback = func() { _ = subTx.Rollback(context.Background()) }
	} else {
		commit = func() error { return nil }
		rollback = func() {}
	}
	defer rollback()

	rows, err := activeTx.Query(ctx, `
		SELECT t.id::text, t.branch_id::text, t.public_number,
		       COALESCE((SELECT MAX(e.id) FROM ticket_events e WHERE e.ticket_id = t.id AND e.type IN ('CREATED', 'RETURNED', 'REDIRECTED', 'ARRIVED')), 0) as cycle_id
		FROM tickets t
		WHERE t.branch_id = $1::uuid
		  AND (t.status = 'WAITING' OR (t.source = 'APPOINTMENT' AND t.status = 'SCHEDULED'))
		  AND (
		      (t.source = 'APPOINTMENT' AND t.arrived_at IS NULL AND (t.scheduled_at IS NULL OR t.scheduled_at <= $2::timestamptz + INTERVAL '15 minutes') AND (t.ready_at IS NULL OR t.ready_at <= $2::timestamptz))
		      OR ((t.source <> 'APPOINTMENT' OR t.arrived_at IS NOT NULL) AND (t.ready_at IS NULL OR t.ready_at <= $2::timestamptz))
		  )
		  AND EXISTS (
		      SELECT 1 FROM windows w
		      WHERE w.branch_id = t.branch_id
		        AND w.status = 'OPEN'
		        AND EXISTS (SELECT 1 FROM window_services ws WHERE ws.window_id = w.id AND ws.service_id = t.service_id)
		        AND (t.window_id IS NULL OR w.id = t.window_id)
		  )
		ORDER BY t.due_at ASC, t.source_rank ASC, t.checkin_at ASC, t.id ASC
		LIMIT 2
	`, branch, decisionTime)
	if err != nil {
		return err
	}
	defer rows.Close()

	type candInfo struct {
		id, branchID, publicNum string
		cycleID                 int64
	}
	var cands []candInfo
	for rows.Next() {
		var c candInfo
		if err := rows.Scan(&c.id, &c.branchID, &c.publicNum, &c.cycleID); err == nil {
			cands = append(cands, c)
		}
	}
	rows.Close()

	for i, c := range cands {
		t := domain.Ticket{ID: c.id, BranchID: c.branchID, PublicNumber: c.publicNum}
		// Existing queue-cycle identity remains the business occurrence; only delivery dedupe gains channel+recipient.
		if err := p.enqueueChannelDeliveries(ctx, activeTx, t, domain.NotificationTicketNearTurn, fmt.Sprintf("%s:%d", c.id, c.cycleID), 0, i+1); err != nil {
			return err
		}
	}
	return commit()
}

// EnqueueNearTurnIfEligible idempotently enqueues a TICKET_NEAR_TURN notification if eligible.
func (p *Postgres) EnqueueNearTurnIfEligible(ctx context.Context, ticketID string) error {
	tID, err := uuid(ticketID)
	if err != nil {
		return err
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return dbError(err)
	}
	defer tx.Rollback(ctx)

	// Establish snapshot time
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT transaction_timestamp()`).Scan(&now); err != nil {
		return dbError(err)
	}
	now = now.UTC()

	// 1. Fetch ticket to verify status, branch, service, eligibility
	var tIDStr, branchID, serviceID, publicNum, source string
	var status domain.TicketStatus
	var targetWindowID *string
	var readyAt, scheduledAt, arrivedAt, dueAt, checkinAt *time.Time
	var sourceRank int
	var queueEnteredAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT id::text, branch_id::text, service_id::text, status, public_number, source,
		       window_id::text, ready_at, scheduled_at, arrived_at, due_at, source_rank, checkin_at, queue_entered_at
		FROM tickets WHERE id = $1
	`, tID).Scan(&tIDStr, &branchID, &serviceID, &status, &publicNum, &source,
		&targetWindowID, &readyAt, &scheduledAt, &arrivedAt, &dueAt, &sourceRank, &checkinAt, &queueEnteredAt)
	if err != nil {
		return dbError(err)
	}

	if status != domain.TicketStatusWaiting && status != domain.TicketStatusScheduled {
		return nil
	}

	// Due eligibility check (same as QueuePosition)
	if source == string(domain.TicketSourceAppointment) && arrivedAt == nil {
		if scheduledAt != nil && scheduledAt.After(now.Add(15*time.Minute)) {
			return nil
		}
		if readyAt != nil && readyAt.After(now) {
			return nil
		}
	} else if readyAt != nil && readyAt.After(now) {
		return nil
	}

	// 2. Open compatible window check (same canonical semantics as QueuePosition)
	var hasOpenWindow bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM windows w
			WHERE w.branch_id = $1::uuid AND w.status = 'OPEN'
			  AND EXISTS (SELECT 1 FROM window_services ws WHERE ws.window_id = w.id AND ws.service_id = $2::uuid)
			  AND ($3::uuid IS NULL OR w.id = $3::uuid)
		)
	`, branchID, serviceID, targetWindowID).Scan(&hasOpenWindow)
	if err != nil {
		return dbError(err)
	}
	if !hasOpenWindow {
		return nil
	}

	// 3. True canonical queue position check (must be rank <= 2 in branch queue)
	effectiveDue := now
	if dueAt != nil {
		effectiveDue = *dueAt
	} else if scheduledAt != nil {
		effectiveDue = *scheduledAt
	}
	effectiveCheckin := queueEnteredAt
	if checkinAt != nil {
		effectiveCheckin = *checkinAt
	} else if arrivedAt != nil {
		effectiveCheckin = *arrivedAt
	}

	var rank int
	err = tx.QueryRow(ctx, `
		SELECT count(*) + 1
		FROM tickets c
		WHERE c.branch_id = $1::uuid
		  AND (c.status = 'WAITING' OR (c.source = 'APPOINTMENT' AND c.status = 'SCHEDULED'))
		  AND (
		      (c.source = 'APPOINTMENT' AND c.arrived_at IS NULL AND (c.scheduled_at IS NULL OR c.scheduled_at <= $2::timestamptz + INTERVAL '15 minutes') AND (c.ready_at IS NULL OR c.ready_at <= $2::timestamptz))
		      OR ((c.source <> 'APPOINTMENT' OR c.arrived_at IS NOT NULL) AND (c.ready_at IS NULL OR c.ready_at <= $2::timestamptz))
		  )
		  AND EXISTS (
		      SELECT 1 FROM windows w
		      WHERE w.branch_id = c.branch_id AND w.status = 'OPEN'
		        AND EXISTS (SELECT 1 FROM window_services ws WHERE ws.window_id = w.id AND ws.service_id = c.service_id)
		        AND (c.window_id IS NULL OR w.id = c.window_id)
		  )
		  AND (c.due_at, c.source_rank, c.checkin_at, c.id) < ($3::timestamptz, $4::int, $5::timestamptz, $6::uuid)
	`, branchID, now, effectiveDue, sourceRank, effectiveCheckin, tID).Scan(&rank)
	if err != nil {
		return dbError(err)
	}
	if rank > 2 {
		return nil
	}

	// 4. Stable queue-entry cycle identity and DB-level deduplication
	var cycleID int64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(e.id), 0)
		FROM ticket_events e
		WHERE e.ticket_id = $1::uuid AND e.type IN ('CREATED', 'RETURNED', 'REDIRECTED', 'ARRIVED')
	`, tID).Scan(&cycleID)
	if err != nil {
		return dbError(err)
	}

	_ = publicNum
	if err = p.enqueueChannelDeliveries(ctx, tx, domain.Ticket{ID: tIDStr, BranchID: branchID, PublicNumber: publicNum}, domain.NotificationTicketNearTurn, fmt.Sprintf("%s:%d", tIDStr, cycleID), 0, rank); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

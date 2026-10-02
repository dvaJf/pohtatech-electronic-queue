package persistence

import (
	"context"
	"fmt"
	"time"

	"postcode/backend/internal/domain"
)

// ReconcileStaleTickets checks for tickets stuck in CALLED state where the client
// did not arrive within client_timeout_seconds. It either recalls the ticket (up to max_recalls)
// or marks it NO_SHOW.
func (p *Postgres) ReconcileStaleTickets(ctx context.Context, authoritativeTime time.Time) error {
	policy := p.GetPolicy()
	timeoutSec := policy.Call.ClientTimeoutSeconds
	if timeoutSec <= 0 {
		timeoutSec = 90
	}
	maxRecalls := policy.Call.MaxRecalls
	if maxRecalls <= 0 {
		maxRecalls = 2
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return dbError(err)
	}
	defer tx.Rollback(context.Background())

	// Find tickets in CALLED status where called_at + timeout < authoritativeTime
	cutoff := authoritativeTime.Add(-time.Duration(timeoutSec) * time.Second)

	rows, err := tx.Query(ctx, `
		SELECT `+ticketColumns+`
		FROM tickets t
		LEFT JOIN windows w ON w.id = t.window_id
		LEFT JOIN services s ON s.id = t.service_id
		WHERE t.status = 'CALLED'
		  AND t.called_at <= $1::timestamptz
		FOR UPDATE OF t SKIP LOCKED
	`, cutoff)
	if err != nil {
		return dbError(err)
	}

	var staleTickets []domain.Ticket
	for rows.Next() {
		t, scanErr := scanTicket(rows)
		if scanErr != nil {
			rows.Close()
			return scanErr
		}
		staleTickets = append(staleTickets, t)
	}
	rows.Close()

	for _, t := range staleTickets {
		from := t.Status
		if t.RecallCount < maxRecalls {
			// Recall: increment recall_count, update called_at to authoritativeTime
			newRecall := t.RecallCount + 1
			_, err = tx.Exec(ctx, `
				UPDATE tickets
				SET recall_count = $1, called_at = $2::timestamptz
				WHERE id = $3::uuid
			`, newRecall, authoritativeTime, t.ID)
			if err != nil {
				return dbError(err)
			}
			t.RecallCount = newRecall
			t.CalledAt = &authoritativeTime

			extra := EventExtra{
				Actor:  "recovery_worker",
				Reason: fmt.Sprintf("recall %d of %d (timeout %ds exceeded)", newRecall, maxRecalls, timeoutSec),
				DueAt:  t.DueAt,
				At:     &authoritativeTime,
			}
			prio := int64(t.SourceRank)
			if err = insertEvent(ctx, tx, t, domain.TicketEventCalled, &from, &policy.PolicyVersion, &prio, extra); err != nil {
				return err
			}
		} else {
			// Max recalls exceeded: transition to NO_SHOW, free the window
			_, err = tx.Exec(ctx, `
				UPDATE tickets
				SET status = 'NO_SHOW', no_show_at = $1::timestamptz
				WHERE id = $2::uuid
			`, authoritativeTime, t.ID)
			if err != nil {
				return dbError(err)
			}
			t.Status = domain.TicketStatusNoShow
			t.NoShowAt = &authoritativeTime

			extra := EventExtra{
				Actor:  "recovery_worker",
				Reason: fmt.Sprintf("marked NO_SHOW after %d recalls (timeout %ds exceeded)", maxRecalls, timeoutSec),
				DueAt:  t.DueAt,
				At:     &authoritativeTime,
			}
			if err = insertEvent(ctx, tx, t, domain.TicketEventNoShow, &from, nil, nil, extra); err != nil {
				return err
			}
			if t.Window != nil {
				var winStatus domain.WindowStatus
				_ = tx.QueryRow(ctx, `SELECT status FROM windows WHERE id=$1::uuid`, t.Window.ID).Scan(&winStatus)
				if winStatus == domain.WindowStatusClosing {
					_, _ = tx.Exec(ctx, `UPDATE windows SET status='CLOSED' WHERE id=$1::uuid`, t.Window.ID)
				}
			}
		}
	}

	return dbError(tx.Commit(ctx))
}

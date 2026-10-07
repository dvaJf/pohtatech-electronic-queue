package persistence

import (
	"context"
	"time"

	"postcode/backend/internal/domain"
)

// GetOperatorQueue returns only the first 25 waiting tickets, not the full overview.
func (p *Postgres) GetOperatorQueue(ctx context.Context, branchID string) (domain.OperatorQueue, error) {
	result := domain.OperatorQueue{Items: make([]domain.AdminQueueTicket, 0, 25)}
	id, err := p.branch(ctx, branchID)
	if err != nil {
		return result, err
	}
	now := time.Now().UTC()
	policy, pErr := p.getQueuePolicyAt(ctx, nil, branchID, now)
	threshold := 10
	grace := 5
	if pErr == nil {
		threshold = policy.AntiStarvationThresholdMinutes
		grace = policy.AppointmentGraceMinutes
	}
	rows, err := p.pool.Query(ctx, `
		SELECT t.id::text, t.public_number, t.source, t.service_id::text,
		       s.name, t.queue_entered_at, t.status, COUNT(*) OVER ()
		FROM tickets t JOIN services s ON s.id = t.service_id
		`+tierRankingLateral("t", "$2::timestamptz", "$3::int", "$4::int")+`
		WHERE t.branch_id = $1 AND (
			t.status = 'WAITING'
			OR (t.source = 'APPOINTMENT' AND t.status = 'SCHEDULED')
		)
		AND t.ready_at <= $2::timestamptz
		AND k.effective_tier >= 0
		ORDER BY k.effective_tier ASC, k.tier_entered_at ASC, t.created_at ASC, t.id ASC
		LIMIT 25
	`, id, now, threshold, grace)
	if err != nil {
		return result, dbError(err)
	}
	defer rows.Close()
	for rows.Next() {
		var item domain.AdminQueueTicket
		if err := rows.Scan(&item.ID, &item.PublicNumber, &item.Source, &item.ServiceID,
			&item.ServiceName, &item.QueueEnteredAt, &item.Status, &result.Total); err != nil {
			return result, dbError(err)
		}
		result.Items = append(result.Items, item)
	}
	if err = rows.Err(); err != nil {
		return result, dbError(err)
	}

	var nextSlot domain.NextAppointmentSlot
	errSlot := p.pool.QueryRow(ctx, `
		SELECT t.scheduled_at, COUNT(*)
		FROM tickets t
		WHERE t.branch_id = $1
		  AND t.source = 'APPOINTMENT'
		  AND t.status = 'SCHEDULED'
		  AND t.scheduled_at >= $2
		GROUP BY t.scheduled_at
		ORDER BY t.scheduled_at ASC
		LIMIT 1
	`, id, now).Scan(&nextSlot.ScheduledAt, &nextSlot.Count)
	if errSlot == nil && nextSlot.Count > 0 {
		result.NextAppointment = &nextSlot
	}

	return result, nil
}

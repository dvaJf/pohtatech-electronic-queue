package persistence

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"postcode/backend/internal/domain"
)

func tierRankingLateral(tAlias, decisionTimeExpr, intervalMinsExpr, graceMinsExpr string) string {
	return fmt.Sprintf(` CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN %[1]s.source = 'APPOINTMENT' AND %[1]s.scheduled_at IS NOT NULL
           AND (COALESCE(%[1]s.arrived_at, %[1]s.checkin_at) IS NOT NULL AND COALESCE(%[1]s.arrived_at, %[1]s.checkin_at) < %[1]s.scheduled_at)
      THEN TRUE
      ELSE FALSE
    END AS is_early_apt
) ea
CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN %[1]s.requeued_at IS NOT NULL THEN %[1]s.requeued_at
      WHEN ea.is_early_apt THEN COALESCE(%[1]s.checkin_at, %[1]s.arrived_at)
      ELSE COALESCE(%[1]s.queue_entered_at, %[1]s.checkin_at)
    END AS cycle_start,
    CASE
      WHEN %[1]s.requeued_at IS NOT NULL AND %[1]s.requeued_at > %[1]s.scheduled_at THEN %[1]s.requeued_at
      ELSE %[1]s.scheduled_at
    END AS apt_start
) cs
CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN %[1]s.source = 'APPOINTMENT' AND %[1]s.scheduled_at IS NOT NULL AND NOT ea.is_early_apt THEN
        CASE
          WHEN %[2]s < cs.apt_start THEN -1
          WHEN %[2]s < cs.apt_start + (%[4]s * INTERVAL '1 minute') THEN 0
          WHEN %[2]s < cs.apt_start + ((%[4]s + %[3]s) * INTERVAL '1 minute') THEN 1
          ELSE 0
        END
      WHEN %[1]s.source = 'QR' THEN
        CASE
          WHEN %[2]s < cs.cycle_start + (%[3]s * INTERVAL '1 minute') THEN 1
          ELSE 0
        END
      WHEN %[1]s.source = 'LIVE' OR (%[1]s.source = 'APPOINTMENT' AND ea.is_early_apt) THEN
        CASE
          WHEN %[2]s < cs.cycle_start + (%[3]s * INTERVAL '1 minute') THEN 2
          WHEN %[2]s < cs.cycle_start + (2 * %[3]s * INTERVAL '1 minute') THEN 1
          ELSE 0
        END
      ELSE -1
    END AS effective_tier,
    CASE
      WHEN %[1]s.source = 'APPOINTMENT' AND %[1]s.scheduled_at IS NOT NULL AND NOT ea.is_early_apt THEN
        CASE
          WHEN %[2]s < cs.apt_start THEN cs.apt_start
          WHEN %[2]s < cs.apt_start + (%[4]s * INTERVAL '1 minute') THEN cs.apt_start
          WHEN %[2]s < cs.apt_start + ((%[4]s + %[3]s) * INTERVAL '1 minute') THEN cs.apt_start + (%[4]s * INTERVAL '1 minute')
          ELSE cs.apt_start + ((%[4]s + %[3]s) * INTERVAL '1 minute')
        END
      WHEN %[1]s.source = 'QR' THEN
        CASE
          WHEN %[2]s < cs.cycle_start + (%[3]s * INTERVAL '1 minute') THEN cs.cycle_start
          ELSE cs.cycle_start + (%[3]s * INTERVAL '1 minute')
        END
      WHEN %[1]s.source = 'LIVE' OR (%[1]s.source = 'APPOINTMENT' AND ea.is_early_apt) THEN
        CASE
          WHEN %[2]s < cs.cycle_start + (%[3]s * INTERVAL '1 minute') THEN cs.cycle_start
          WHEN %[2]s < cs.cycle_start + (2 * %[3]s * INTERVAL '1 minute') THEN cs.cycle_start + (%[3]s * INTERVAL '1 minute')
          ELSE cs.cycle_start + (2 * %[3]s * INTERVAL '1 minute')
        END
      ELSE cs.cycle_start
    END AS tier_entered_at
) k `, tAlias, decisionTimeExpr, intervalMinsExpr, graceMinsExpr)
}

const rankedCandidates = `SELECT t.id, t.status, k.tier_entered_at, k.effective_tier
 FROM tickets t
 CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN t.source = 'APPOINTMENT' AND t.scheduled_at IS NOT NULL
           AND (COALESCE(t.arrived_at, t.checkin_at) IS NOT NULL AND COALESCE(t.arrived_at, t.checkin_at) < t.scheduled_at)
      THEN TRUE
      ELSE FALSE
    END AS is_early_apt
 ) ea
 CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN t.requeued_at IS NOT NULL THEN t.requeued_at
      WHEN ea.is_early_apt THEN COALESCE(t.checkin_at, t.arrived_at)
      ELSE COALESCE(t.queue_entered_at, t.checkin_at)
    END AS cycle_start,
    CASE
      WHEN t.requeued_at IS NOT NULL AND t.requeued_at > t.scheduled_at THEN t.requeued_at
      ELSE t.scheduled_at
    END AS apt_start
 ) cs
 CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN t.source = 'APPOINTMENT' AND t.scheduled_at IS NOT NULL AND NOT ea.is_early_apt THEN
        CASE
          WHEN $3::timestamptz < cs.apt_start THEN -1
          WHEN $3::timestamptz < cs.apt_start + ($5::int * INTERVAL '1 minute') THEN 0
          WHEN $3::timestamptz < cs.apt_start + (($5::int + $4::int) * INTERVAL '1 minute') THEN 1
          ELSE 0
        END
      WHEN t.source = 'QR' THEN
        CASE
          WHEN $3::timestamptz < cs.cycle_start + ($4::int * INTERVAL '1 minute') THEN 1
          ELSE 0
        END
      WHEN t.source = 'LIVE' OR (t.source = 'APPOINTMENT' AND ea.is_early_apt) THEN
        CASE
          WHEN $3::timestamptz < cs.cycle_start + ($4::int * INTERVAL '1 minute') THEN 2
          WHEN $3::timestamptz < cs.cycle_start + (2 * $4::int * INTERVAL '1 minute') THEN 1
          ELSE 0
        END
      ELSE -1
    END AS effective_tier,
    CASE
      WHEN t.source = 'APPOINTMENT' AND t.scheduled_at IS NOT NULL AND NOT ea.is_early_apt THEN
        CASE
          WHEN $3::timestamptz < cs.apt_start THEN cs.apt_start
          WHEN $3::timestamptz < cs.apt_start + ($5::int * INTERVAL '1 minute') THEN cs.apt_start
          WHEN $3::timestamptz < cs.apt_start + (($5::int + $4::int) * INTERVAL '1 minute') THEN cs.apt_start + ($5::int * INTERVAL '1 minute')
          ELSE cs.apt_start + (($5::int + $4::int) * INTERVAL '1 minute')
        END
      WHEN t.source = 'QR' THEN
        CASE
          WHEN $3::timestamptz < cs.cycle_start + ($4::int * INTERVAL '1 minute') THEN cs.cycle_start
          ELSE cs.cycle_start + ($4::int * INTERVAL '1 minute')
        END
      WHEN t.source = 'LIVE' OR (t.source = 'APPOINTMENT' AND ea.is_early_apt) THEN
        CASE
          WHEN $3::timestamptz < cs.cycle_start + ($4::int * INTERVAL '1 minute') THEN cs.cycle_start
          WHEN $3::timestamptz < cs.cycle_start + (2 * $4::int * INTERVAL '1 minute') THEN cs.cycle_start + ($4::int * INTERVAL '1 minute')
          ELSE cs.cycle_start + (2 * $4::int * INTERVAL '1 minute')
        END
      ELSE cs.cycle_start
    END AS tier_entered_at
 ) k
 WHERE t.branch_id = $2::uuid
   AND (t.window_id IS NULL OR t.window_id = $1::uuid)
   AND (t.window_id = $1::uuid OR EXISTS (SELECT 1 FROM window_services ws WHERE ws.window_id = $1::uuid AND ws.service_id = t.service_id))
   AND (t.status = 'WAITING' OR (t.source = 'APPOINTMENT' AND t.status = 'SCHEDULED'))
   AND t.ready_at <= $3::timestamptz
   AND k.effective_tier >= 0`
const rankingOrder = `(CASE WHEN t.window_id = $1::uuid THEN 0 ELSE 1 END) ASC, k.effective_tier ASC, k.tier_entered_at ASC, t.created_at ASC, t.id ASC`
const canonicalOrder = ` ORDER BY ` + rankingOrder

func rankingArgs(window, branch string, at time.Time, p domain.QueuePolicy) []any {
	return []any{window, branch, at, p.AntiStarvationThresholdMinutes, p.AppointmentGraceMinutes}
}

func (p *Postgres) GetQueuePosition(ctx context.Context, ticketID string) (domain.QueuePosition, error) {
	var out domain.QueuePosition
	_, err := uuid(ticketID)
	if err != nil {
		return out, err
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return out, dbError(err)
	}
	defer tx.Rollback(context.Background())
	return queuePosition(ctx, tx, ticketID)
}

// queuePosition is shared by QueuePosition and ETA in a read-only snapshot.
func queuePosition(ctx context.Context, tx pgx.Tx, ticketID string) (domain.QueuePosition, error) {
	var out domain.QueuePosition
	var err error
	if err = tx.QueryRow(ctx, `SELECT transaction_timestamp()`).Scan(&out.CalculatedAt); err != nil {
		return out, dbError(err)
	}
	out.CalculatedAt = out.CalculatedAt.UTC()
	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1`, ticketID))
	if err != nil {
		return out, err
	}
	out.TicketID = t.ID
	out.TicketStatus = t.Status
	out.Reason = domain.QueuePositionNotQueued
	if t.Status != domain.TicketStatusWaiting && t.Status != domain.TicketStatusScheduled {
		return out, nil
	}

	branchUUID, err := uuid(t.BranchID)
	if err != nil {
		return out, err
	}
	policy, err := scanPolicy(tx.QueryRow(ctx, policyAtSelect, branchUUID, out.CalculatedAt))
	if err != nil {
		return out, dbError(err)
	}

	var myTier int
	var myTierEnteredAt time.Time
	err = tx.QueryRow(ctx, `SELECT k.effective_tier, k.tier_entered_at
		FROM tickets t
		`+tierRankingLateral("t", "$2::timestamptz", "$3::int", "$4::int")+`
		WHERE t.id = $1::uuid`, t.ID, out.CalculatedAt, policy.AntiStarvationThresholdMinutes, policy.AppointmentGraceMinutes).Scan(&myTier, &myTierEnteredAt)
	if err != nil {
		return out, dbError(err)
	}
	myTierEnteredAt = myTierEnteredAt.UTC()

	if myTier < 0 || (t.ReadyAt != nil && t.ReadyAt.After(out.CalculatedAt)) {
		out.Reason = domain.QueuePositionNotEligibleYet
		return out, nil
	}

	var targetWindowID *string
	if t.Window != nil {
		targetWindowID = &t.Window.ID
	}
	var w domain.WindowRef
	err = tx.QueryRow(ctx, `SELECT w.id::text,w.number FROM windows w
 WHERE w.branch_id=$1::uuid AND w.status='OPEN'
 AND EXISTS(SELECT 1 FROM window_services ws WHERE ws.window_id=w.id AND ws.service_id=$2::uuid)
 AND ($3::uuid IS NULL OR w.id=$3::uuid)
 ORDER BY w.number,w.id LIMIT 1`, t.BranchID, t.ServiceID, targetWindowID).Scan(&w.ID, &w.Number)
	if errors.Is(err, pgx.ErrNoRows) {
		out.Reason = domain.QueuePositionNoOpenCompatibleWindow
		return out, nil
	}
	if err != nil {
		return out, dbError(err)
	}

	var rank int
	err = tx.QueryRow(ctx, `
		SELECT count(*) + 1
		FROM tickets c
		`+tierRankingLateral("c", "$3::timestamptz", "$4::int", "$5::int")+`
		WHERE c.branch_id = $1::uuid
		  AND (c.status = 'WAITING' OR (c.source = 'APPOINTMENT' AND c.status = 'SCHEDULED'))
		  AND (c.window_id IS NULL OR c.window_id = $2::uuid)
		  AND EXISTS (SELECT 1 FROM window_services ws WHERE ws.window_id = $2::uuid AND ws.service_id = c.service_id)
		  AND c.ready_at <= $3::timestamptz
		  AND k.effective_tier >= 0
		  AND (k.effective_tier, k.tier_entered_at, c.created_at, c.id) < ($6::int, $7::timestamptz, $8::timestamptz, $9::uuid)
	`, t.BranchID, w.ID, out.CalculatedAt, policy.AntiStarvationThresholdMinutes, policy.AppointmentGraceMinutes,
		myTier, myTierEnteredAt, t.CreatedAt, t.ID).Scan(&rank)
	if err != nil {
		return out, dbError(err)
	}

	out.Position = &rank

	prio := int64(myTier)
	out.EffectivePriority = &prio
	out.EffectiveQueueTime = &myTierEnteredAt
	out.Reason = domain.QueuePositionAvailable
	out.ReferenceWindow = &w
	return out, nil
}

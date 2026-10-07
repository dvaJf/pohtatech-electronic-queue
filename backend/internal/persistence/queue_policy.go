package persistence

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

const policyColumns = `branch_id::text,appointment_due_priority,qr_priority,live_priority,
 anti_starvation_threshold_minutes,anti_starvation_points_per_minute,appointment_grace_minutes,
 appointment_late_penalty_per_minute,appointment_late_penalty_max_points,version,updated_at,
 scheduled_promotion_interval_minutes,scheduled_appointment_grace_minutes,scheduled_effective_date`
const policySelect = `SELECT ` + policyColumns + ` FROM queue_policies`

// timezone_offset is stored in hours. Explicit UTC conversion makes the local
// date independent of the PostgreSQL connection's session timezone.
const policyAtSelect = `WITH policy_at AS (
 SELECT qp.*, scheduled_effective_date <=
  (timezone('UTC',$2::timestamptz) + make_interval(hours => b.timezone_offset))::date AS schedule_due
 FROM queue_policies qp JOIN branches b ON b.id=qp.branch_id WHERE qp.branch_id=$1
)
SELECT branch_id::text,appointment_due_priority,qr_priority,live_priority,
 CASE WHEN schedule_due THEN scheduled_promotion_interval_minutes ELSE anti_starvation_threshold_minutes END,
 anti_starvation_points_per_minute,
 CASE WHEN schedule_due THEN scheduled_appointment_grace_minutes ELSE appointment_grace_minutes END,
 appointment_late_penalty_per_minute,appointment_late_penalty_max_points,version,updated_at,
 CASE WHEN schedule_due THEN NULL ELSE scheduled_promotion_interval_minutes END,
 CASE WHEN schedule_due THEN NULL ELSE scheduled_appointment_grace_minutes END,
 CASE WHEN schedule_due THEN NULL ELSE scheduled_effective_date END
FROM policy_at`

func scanPolicy(row pgx.Row) (domain.QueuePolicy, error) {
	var p domain.QueuePolicy
	err := row.Scan(&p.BranchID, &p.AppointmentDuePriority, &p.QRPriority, &p.LivePriority,
		&p.AntiStarvationThresholdMinutes, &p.AntiStarvationPointsPerMinute, &p.AppointmentGraceMinutes,
		&p.AppointmentLatePenaltyPerMinute, &p.AppointmentLatePenaltyMaxPoints, &p.Version, &p.UpdatedAt,
		&p.ScheduledAntiStarvationThresholdMinutes, &p.ScheduledAppointmentGraceMinutes, &p.ScheduledEffectiveDate)
	p.UpdatedAt = p.UpdatedAt.UTC()
	return p, dbError(err)
}

func (p *Postgres) GetQueuePolicy(ctx context.Context, branchID string) (domain.QueuePolicy, error) {
	return p.getQueuePolicyAt(ctx, nil, branchID, time.Now())
}

func (p *Postgres) getQueuePolicyAt(ctx context.Context, tx pgx.Tx, branchID string, at time.Time) (domain.QueuePolicy, error) {
	id, err := uuid(branchID)
	if err != nil {
		return domain.QueuePolicy{}, err
	}
	if tx != nil {
		return scanPolicy(tx.QueryRow(ctx, policyAtSelect, id, at))
	}
	return scanPolicy(p.pool.QueryRow(ctx, policyAtSelect, id, at))
}

func validPolicy(c application.UpdateQueuePolicyCommand) bool {
	return c.AppointmentDuePriority >= 0 && c.AppointmentDuePriority <= 1000 &&
		c.QRPriority >= 0 && c.QRPriority <= 1000 && c.LivePriority >= 0 && c.LivePriority <= 1000 &&
		c.AppointmentDuePriority > c.QRPriority && c.AppointmentDuePriority > c.LivePriority &&
		(c.AntiStarvationThresholdMinutes == 10 || c.AntiStarvationThresholdMinutes == 15 || c.AntiStarvationThresholdMinutes == 20) &&
		c.AntiStarvationPointsPerMinute >= 1 && c.AntiStarvationPointsPerMinute <= 600 &&
		(c.AppointmentGraceMinutes == 5 || c.AppointmentGraceMinutes == 10 || c.AppointmentGraceMinutes == 15) &&
		c.AppointmentLatePenaltyPerMinute >= 0 && c.AppointmentLatePenaltyPerMinute <= 600 &&
		c.AppointmentLatePenaltyMaxPoints >= 0 && c.AppointmentLatePenaltyMaxPoints <= 1000 &&
		c.AppointmentLatePenaltyMaxPoints <= c.AppointmentDuePriority
}

func (p *Postgres) getBranchPolicyTx(ctx context.Context, tx pgx.Tx, branchID pgtype.UUID) domain.QueuePolicyConfig {
	base := p.GetPolicy()
	policy, err := p.getQueuePolicyAt(ctx, tx, branchID.String(), time.Now())
	if err == nil {
		qrRank, liveRank := 1, 2
		if policy.LivePriority > policy.QRPriority {
			qrRank, liveRank = 2, 1
		}
		base.Appointment.GraceMinutes = policy.AppointmentGraceMinutes
		base.Appointment.LatePenaltyPerMinute = policy.AppointmentLatePenaltyPerMinute
		base.Appointment.LatePenaltyMaxPoints = policy.AppointmentLatePenaltyMaxPoints
		newSources := make(map[string]domain.SourcePolicy, len(base.Sources))
		for k, v := range base.Sources {
			newSources[k] = v
		}
		if qr, ok := newSources["qr"]; ok {
			qr.Rank = qrRank
			qr.MaxWaitMinutes = &policy.AntiStarvationThresholdMinutes
			newSources["qr"] = qr
		}
		if live, ok := newSources["live"]; ok {
			live.Rank = liveRank
			live.MaxWaitMinutes = &policy.AntiStarvationThresholdMinutes
			newSources["live"] = live
		}
		base.Sources = newSources
	}
	return base
}

func (p *Postgres) UpdateQueuePolicy(ctx context.Context, c application.UpdateQueuePolicyCommand) (domain.QueuePolicy, error) {
	return p.updateQueuePolicyAt(ctx, c, time.Now())
}

func (p *Postgres) updateQueuePolicyAt(ctx context.Context, c application.UpdateQueuePolicyCommand, at time.Time) (domain.QueuePolicy, error) {
	var empty domain.QueuePolicy
	id, err := uuid(c.BranchID)
	if err != nil {
		return empty, err
	}
	if !validPolicy(c) {
		return empty, application.ErrInvalidState
	}

	// One optimistic UPDATE both folds any due schedule and replaces tomorrow's
	// schedule. Concurrent administrators cannot overwrite the winning version.
	result, err := scanPolicy(p.pool.QueryRow(ctx, `UPDATE queue_policies qp SET
 appointment_due_priority=$2,qr_priority=$3,live_priority=$4,
 anti_starvation_threshold_minutes=CASE WHEN scheduled_effective_date <=
  (timezone('UTC',$11::timestamptz)+make_interval(hours => b.timezone_offset))::date
  THEN scheduled_promotion_interval_minutes ELSE anti_starvation_threshold_minutes END,
 anti_starvation_points_per_minute=$6,
 appointment_grace_minutes=CASE WHEN scheduled_effective_date <=
  (timezone('UTC',$11::timestamptz)+make_interval(hours => b.timezone_offset))::date
  THEN scheduled_appointment_grace_minutes ELSE appointment_grace_minutes END,
 appointment_late_penalty_per_minute=$8,appointment_late_penalty_max_points=$9,
 scheduled_promotion_interval_minutes=$5,scheduled_appointment_grace_minutes=$7,
 scheduled_effective_date=(timezone('UTC',$11::timestamptz)+make_interval(hours => b.timezone_offset))::date+1,
 version=version+1,updated_at=$11
 FROM branches b WHERE qp.branch_id=b.id AND qp.branch_id=$1 AND version=$10
 RETURNING `+policyColumns,
		id, c.AppointmentDuePriority, c.QRPriority, c.LivePriority, c.AntiStarvationThresholdMinutes,
		c.AntiStarvationPointsPerMinute, c.AppointmentGraceMinutes, c.AppointmentLatePenaltyPerMinute,
		c.AppointmentLatePenaltyMaxPoints, c.ExpectedVersion, at))
	if errors.Is(err, application.ErrNotFound) {
		if _, lookupErr := p.getQueuePolicyAt(ctx, nil, c.BranchID, at); lookupErr != nil {
			return empty, lookupErr
		}
		return empty, application.ErrPolicyVersionConflict
	}
	return result, err
}

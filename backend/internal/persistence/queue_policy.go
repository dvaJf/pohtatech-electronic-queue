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
 appointment_late_penalty_per_minute,appointment_late_penalty_max_points,version,updated_at`
const policySelect = `SELECT ` + policyColumns + ` FROM queue_policies`

func scanPolicy(row pgx.Row) (domain.QueuePolicy, error) {
	var p domain.QueuePolicy
	err := row.Scan(&p.BranchID, &p.AppointmentDuePriority, &p.QRPriority, &p.LivePriority,
		&p.AntiStarvationThresholdMinutes, &p.AntiStarvationPointsPerMinute, &p.AppointmentGraceMinutes,
		&p.AppointmentLatePenaltyPerMinute, &p.AppointmentLatePenaltyMaxPoints, &p.Version, &p.UpdatedAt)
	p.UpdatedAt = p.UpdatedAt.UTC()
	return p, dbError(err)
}
func (p *Postgres) GetQueuePolicy(ctx context.Context, branchID string) (domain.QueuePolicy, error) {
	id, err := uuid(branchID)
	if err != nil {
		return domain.QueuePolicy{}, err
	}
	return scanPolicy(p.pool.QueryRow(ctx, policySelect+` WHERE branch_id=$1`, id))
}
func validPolicy(c application.UpdateQueuePolicyCommand) bool {
	return c.AppointmentDuePriority >= 0 && c.AppointmentDuePriority <= 1000 &&
		c.QRPriority >= 0 && c.QRPriority <= 1000 && c.LivePriority >= 0 && c.LivePriority <= 1000 &&
		c.AppointmentDuePriority > c.QRPriority && c.AppointmentDuePriority > c.LivePriority &&
		c.AntiStarvationThresholdMinutes >= 0 && c.AntiStarvationThresholdMinutes <= 240 &&
		c.AntiStarvationPointsPerMinute >= 1 && c.AntiStarvationPointsPerMinute <= 600 &&
		c.AppointmentGraceMinutes >= 0 && c.AppointmentGraceMinutes <= 120 &&
		c.AppointmentLatePenaltyPerMinute >= 0 && c.AppointmentLatePenaltyPerMinute <= 600 &&
		c.AppointmentLatePenaltyMaxPoints >= 0 && c.AppointmentLatePenaltyMaxPoints <= 1000 &&
		c.AppointmentLatePenaltyMaxPoints <= c.AppointmentDuePriority
}

func (p *Postgres) getBranchPolicyTx(ctx context.Context, tx pgx.Tx, branchID pgtype.UUID) domain.QueuePolicyConfig {
	base := p.GetPolicy()
	var qrPri, livePri, graceMin, starveMin, latePenaltyMin, latePenaltyMax int
	var err error
	if tx != nil {
		err = tx.QueryRow(ctx, `SELECT qr_priority, live_priority, appointment_grace_minutes, anti_starvation_threshold_minutes, appointment_late_penalty_per_minute, appointment_late_penalty_max_points FROM queue_policies WHERE branch_id=$1`, branchID).Scan(&qrPri, &livePri, &graceMin, &starveMin, &latePenaltyMin, &latePenaltyMax)
	} else {
		err = p.pool.QueryRow(ctx, `SELECT qr_priority, live_priority, appointment_grace_minutes, anti_starvation_threshold_minutes, appointment_late_penalty_per_minute, appointment_late_penalty_max_points FROM queue_policies WHERE branch_id=$1`, branchID).Scan(&qrPri, &livePri, &graceMin, &starveMin, &latePenaltyMin, &latePenaltyMax)
	}
	if err == nil {
		qrRank := 1
		liveRank := 2
		if livePri > qrPri {
			qrRank = 2
			liveRank = 1
		}
		if graceMin >= 0 {
			base.Appointment.GraceMinutes = graceMin
		}
		if latePenaltyMin >= 0 {
			base.Appointment.LatePenaltyPerMinute = latePenaltyMin
		}
		if latePenaltyMax >= 0 {
			base.Appointment.LatePenaltyMaxPoints = latePenaltyMax
		}
		newSources := make(map[string]domain.SourcePolicy, len(base.Sources))
		for k, v := range base.Sources {
			newSources[k] = v
		}
		if qr, ok := newSources["qr"]; ok {
			qr.Rank = qrRank
			if starveMin >= 0 {
				qr.MaxWaitMinutes = &starveMin
			}
			newSources["qr"] = qr
		}
		if live, ok := newSources["live"]; ok {
			live.Rank = liveRank
			if starveMin >= 0 {
				live.MaxWaitMinutes = &starveMin
			}
			newSources["live"] = live
		}
		base.Sources = newSources
	}
	return base
}

func (p *Postgres) UpdateQueuePolicy(ctx context.Context, c application.UpdateQueuePolicyCommand) (domain.QueuePolicy, error) {
	var empty domain.QueuePolicy
	id, err := uuid(c.BranchID)
	if err != nil {
		return empty, err
	}
	if !validPolicy(c) {
		return empty, application.ErrInvalidState
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(context.Background())

	result, err := scanPolicy(tx.QueryRow(ctx, `UPDATE queue_policies SET
 appointment_due_priority=$2,qr_priority=$3,live_priority=$4,
 anti_starvation_threshold_minutes=$5,anti_starvation_points_per_minute=$6,
 appointment_grace_minutes=$7,appointment_late_penalty_per_minute=$8,
 appointment_late_penalty_max_points=$9,version=version+1,updated_at=transaction_timestamp()
 WHERE branch_id=$1 AND version=$10 RETURNING `+policyColumns,
		id, c.AppointmentDuePriority, c.QRPriority, c.LivePriority, c.AntiStarvationThresholdMinutes,
		c.AntiStarvationPointsPerMinute, c.AppointmentGraceMinutes, c.AppointmentLatePenaltyPerMinute,
		c.AppointmentLatePenaltyMaxPoints, c.ExpectedVersion))
	if err != nil {
		if errors.Is(err, application.ErrNotFound) {
			if _, errChk := p.GetQueuePolicy(ctx, c.BranchID); errChk != nil {
				return empty, errChk
			}
			return empty, application.ErrPolicyVersionConflict
		}
		return empty, err
	}

	qrRank := 1
	liveRank := 2
	if c.LivePriority > c.QRPriority {
		qrRank = 2
		liveRank = 1
	}

	// Canonical schedule recalculation using shared domain.ComputeSchedule boundary
	branchPolicy := p.getBranchPolicyTx(ctx, tx, id)

	type ticketRecalc struct {
		id             string
		source         domain.TicketSource
		scheduledAt    *time.Time
		serviceID      string
		checkinAt      *time.Time
		arrivedAt      *time.Time
		queueEnteredAt time.Time
		status         domain.TicketStatus
		oldDueAt       *time.Time
		oldSourceRank  int
		requeuedAt     *time.Time
	}

	rows, err := tx.Query(ctx, `
		SELECT t.id::text, t.source, t.scheduled_at, t.service_id::text, t.checkin_at, t.arrived_at, t.queue_entered_at, t.status, t.due_at, t.source_rank, t.requeued_at
		FROM tickets t
		WHERE t.branch_id = $1 AND (t.status = 'WAITING' OR (t.source = 'APPOINTMENT' AND t.status = 'SCHEDULED'))
		FOR UPDATE SKIP LOCKED
	`, id)
	if err != nil {
		return empty, dbError(err)
	}

	var candidates []ticketRecalc
	for rows.Next() {
		var item ticketRecalc
		var srcStr, statusStr string
		if err = rows.Scan(&item.id, &srcStr, &item.scheduledAt, &item.serviceID, &item.checkinAt, &item.arrivedAt, &item.queueEnteredAt, &statusStr, &item.oldDueAt, &item.oldSourceRank, &item.requeuedAt); err != nil {
			rows.Close()
			return empty, dbError(err)
		}
		item.source = domain.TicketSource(srcStr)
		item.status = domain.TicketStatus(statusStr)
		candidates = append(candidates, item)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return empty, dbError(err)
	}
	rows.Close()

	for _, item := range candidates {
		var checkin time.Time
		if item.source == domain.TicketSourceAppointment {
			if item.checkinAt != nil {
				checkin = *item.checkinAt
			} else if item.arrivedAt != nil {
				checkin = *item.arrivedAt
			}
		} else {
			if item.checkinAt != nil {
				checkin = *item.checkinAt
			} else {
				checkin = item.queueEnteredAt
			}
		}

		newDueAt, newReadyAt, newSourceRank := domain.ComputeSchedule(branchPolicy, domain.ScheduleTicketInput{
			Source:      item.source,
			ScheduledAt: item.scheduledAt,
			ServiceID:   item.serviceID,
			IsRequeued:  item.requeuedAt != nil,
		}, checkin)

		_, err = tx.Exec(ctx, `UPDATE tickets SET due_at = $1, ready_at = $2, source_rank = $3, policy_version = $4 WHERE id = $5::uuid`,
			newDueAt, newReadyAt, newSourceRank, result.Version, item.id)
		if err != nil {
			return empty, dbError(err)
		}

		// Audit record: immutable scheduling-change event if persisted values changed
		if item.oldDueAt == nil || !newDueAt.Equal(*item.oldDueAt) || newSourceRank != item.oldSourceRank {
			tkt := domain.Ticket{
				ID:     item.id,
				Status: item.status,
				DueAt:  &newDueAt,
			}
			recalcExtra := EventExtra{
				Actor:  "policy_update",
				Reason: "policy recalculation: due_at or source_rank updated",
				DueAt:  &newDueAt,
			}
			if err = insertEvent(ctx, tx, tkt, domain.TicketEventQueueRecalculated, nil, &result.Version, nil, recalcExtra); err != nil {
				return empty, err
			}
		}
	}

	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}

	// Update in-memory fallback policy as well
	p.policyMu.Lock()
	if p.policy.Sources != nil {
		p.policy.Appointment.GraceMinutes = c.AppointmentGraceMinutes
		p.policy.Appointment.LatePenaltyPerMinute = c.AppointmentLatePenaltyPerMinute
		p.policy.Appointment.LatePenaltyMaxPoints = c.AppointmentLatePenaltyMaxPoints
		if qr, ok := p.policy.Sources["qr"]; ok {
			qr.Rank = qrRank
			if c.AntiStarvationThresholdMinutes >= 0 {
				qr.MaxWaitMinutes = &c.AntiStarvationThresholdMinutes
			}
			p.policy.Sources["qr"] = qr
		}
		if live, ok := p.policy.Sources["live"]; ok {
			live.Rank = liveRank
			if c.AntiStarvationThresholdMinutes >= 0 {
				live.MaxWaitMinutes = &c.AntiStarvationThresholdMinutes
			}
			p.policy.Sources["live"] = live
		}
	}
	p.policyMu.Unlock()

	return result, nil
}


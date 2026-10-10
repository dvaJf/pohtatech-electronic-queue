package persistence

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

// GetBranchWorkload returns hourly workload statistics and current waiting load for a branch.
func (p *Postgres) GetBranchWorkload(ctx context.Context, branchID string) (domain.BranchWorkload, error) {
	id, err := p.branch(ctx, branchID)
	if err != nil {
		return domain.BranchWorkload{}, err
	}

		nowMoscow := time.Now().In(time.FixedZone("MSK", 3*3600))
	currentHour := nowMoscow.Hour()

	type baseline struct {
		hour int
		load int
		wait int
	}
	// Yandex / Google Maps Popularity Curves for Postal Offices (Почта России)
	baseMap := map[int]baseline{
		8:  {8, 20, 5},
		9:  {9, 45, 10},
		10: {10, 50, 12},
		11: {11, 60, 15},
		12: {12, 85, 21},
		13: {13, 90, 24},
		14: {14, 75, 18},
		15: {15, 65, 15},
		16: {16, 60, 14},
		17: {17, 85, 22},
		18: {18, 95, 27},
		19: {19, 75, 18},
		20: {20, 45, 11},
		21: {21, 20, 5},
	}
	if nowMoscow.Weekday() == time.Saturday {
		baseMap = map[int]baseline{
			8:  {8, 15, 4},
			9:  {9, 30, 7},
			10: {10, 50, 12},
			11: {11, 75, 18},
			12: {12, 85, 22},
			13: {13, 90, 24},
			14: {14, 80, 20},
			15: {15, 70, 16},
			16: {16, 50, 12},
			17: {17, 35, 8},
			18: {18, 25, 6},
			19: {19, 15, 4},
			20: {20, 10, 3},
			21: {21, 5, 2},
		}
	} else if nowMoscow.Weekday() == time.Sunday {
		baseMap = map[int]baseline{
			8:  {8, 10, 3},
			9:  {9, 20, 5},
			10: {10, 35, 8},
			11: {11, 50, 12},
			12: {12, 65, 16},
			13: {13, 70, 18},
			14: {14, 60, 14},
			15: {15, 50, 12},
			16: {16, 40, 9},
			17: {17, 30, 7},
			18: {18, 20, 5},
			19: {19, 15, 4},
			20: {20, 10, 3},
			21: {21, 5, 2},
		}
	}

		rows, err := p.pool.Query(ctx, `
		SELECT EXTRACT(HOUR FROM (created_at AT TIME ZONE 'Europe/Moscow'))::int AS h, COUNT(*)
		FROM tickets
		WHERE branch_id = $1
		  AND created_at >= NOW() - interval '30 days'
		GROUP BY h
	`, id)
	if err != nil {
		return domain.BranchWorkload{}, dbError(err)
	}
	defer rows.Close()

	historicalCounts := make(map[int]int)
	totalHistory := 0
	maxCount := 0
	for rows.Next() {
		var h, count int
		if err := rows.Scan(&h, &count); err != nil {
			return domain.BranchWorkload{}, dbError(err)
		}
		historicalCounts[h] = count
		totalHistory += count
		if count > maxCount {
			maxCount = count
		}
	}

	if err := rows.Err(); err != nil {
		return domain.BranchWorkload{}, dbError(err)
	}
	rows.Close()

		scheduledCounts := make(map[int]int)
	srows, err := p.pool.Query(ctx, `
		SELECT EXTRACT(HOUR FROM (scheduled_at AT TIME ZONE 'Europe/Moscow'))::int AS h, COUNT(*)
		FROM tickets
		WHERE branch_id = $1
		  AND status IN ('SCHEDULED', 'WAITING', 'CALLED', 'SERVING', 'COMPLETED')
		  AND scheduled_at IS NOT NULL
		  AND (scheduled_at AT TIME ZONE 'Europe/Moscow')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date
		GROUP BY h
	`, id)
	if err == nil {
		for srows.Next() {
			var h, count int
			if scanErr := srows.Scan(&h, &count); scanErr == nil {
				scheduledCounts[h] = count
			}
		}
		srows.Close()
	}

	var currentWaiting, activeWindows, serving, samples int
	var averageSeconds float64
	err = p.pool.QueryRow(ctx, `SELECT
 (SELECT count(*) FROM tickets WHERE branch_id=$1 AND (status='WAITING' OR (status='SCHEDULED' AND ready_at <= now()))),
 (SELECT count(*) FROM windows WHERE branch_id=$1 AND status='OPEN'),
 (SELECT count(*) FROM tickets t JOIN windows w ON w.id=t.window_id WHERE t.branch_id=$1 AND w.status='OPEN' AND t.status IN ('CALLED','SERVING')),
 count(*), coalesce(avg(seconds),300)
 FROM (SELECT extract(epoch FROM completed_at-service_started_at) AS seconds
 FROM tickets WHERE branch_id=$1 AND status='COMPLETED' AND completed_at > service_started_at
 AND completed_at-service_started_at <= interval '2 hours'
 ORDER BY completed_at DESC LIMIT 100) history`, id).Scan(&currentWaiting, &activeWindows, &serving, &samples, &averageSeconds)
	if err != nil {
		return domain.BranchWorkload{}, dbError(err)
	}
	if samples < 3 {
		averageSeconds = 300
	}

		hourly := make([]domain.HourlyWorkload, 0, 14)
	for h := 8; h <= 21; h++ {
		base := baseMap[h]
		loadPct := base.load
		waitMin := base.wait

		if totalHistory > 0 && maxCount > 0 {
			histRatio := float64(historicalCounts[h]) / float64(maxCount)
			histPct := int(histRatio * 100)
			weight := float64(totalHistory) / 20.0
			if weight > 1.0 {
				weight = 1.0
			}
			loadPct = int(float64(histPct)*0.7*weight + float64(base.load)*(1.0-0.7*weight))
			if loadPct < 5 {
				loadPct = 5
			}
			waitMin = int(float64(loadPct) * 0.3)
		}

		// Dynamic correction from today's booked appointments
		if apptCount, ok := scheduledCounts[h]; ok && apptCount > 0 {
			loadPct += apptCount * 12
			if loadPct > 100 {
				loadPct = 100
			}
			waitMin = int(float64(loadPct) * 0.3)
		}

		// Calibrate current hour if live waiting count is high
		if h == currentHour {
			if currentWaiting > 0 {
				liveWaitEstimate := currentWaiting * 4
				if liveWaitEstimate > waitMin {
					waitMin = liveWaitEstimate
				}
				liveLoad := currentWaiting * 15
				if liveLoad > loadPct {
					loadPct = liveLoad
				}
				if loadPct > 100 {
					loadPct = 100
				}
			}
		}

		hourly = append(hourly, domain.HourlyWorkload{
			Hour:        h,
			LoadPercent: loadPct,
			WaitMinutes: waitMin,
			IsPeak:      loadPct >= 70,
		})
	}

	return domain.BranchWorkload{
		BranchID:             branchID,
		ActiveWindows:        activeWindows,
		EstimatedWaitSeconds: estimateBranchWait(currentWaiting+serving, activeWindows, averageSeconds),
		CalculatedAt:         time.Now().UTC(),
		UsedFallback:         samples < 3,
		CurrentHour:          currentHour,
		CurrentWaiting:       currentWaiting,
		SampleCount:          totalHistory,
		IsHistorical:         totalHistory >= 10,
		Hourly:               hourly,
	}, nil
}

// CloseShift implements end-of-shift lifecycle:
// - Windows serving clients transition to CLOSING so operators finish their customer
// - Idle open windows transition to CLOSED
// - All uncalled WAITING and SCHEDULED tickets are marked CANCELLED with audit events
func (p *Postgres) CloseShift(ctx context.Context, branchID string) (domain.ShiftClosureResult, error) {
	var result domain.ShiftClosureResult
	result.BranchID = branchID

	id, err := p.branch(ctx, branchID)
	if err != nil {
		return result, err
	}

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return result, dbError(err)
	}
	defer tx.Rollback(context.Background())

		rows, err := tx.Query(ctx, `
		SELECT w.id::text,
		       EXISTS(SELECT 1 FROM tickets t WHERE t.window_id = w.id AND t.status IN ('CALLED','SERVING')) AS is_busy
		FROM windows w
		WHERE w.branch_id = $1 AND w.status = 'OPEN'
		FOR UPDATE
	`, id)
	if err != nil {
		return result, dbError(err)
	}
	defer rows.Close()

	type wndState struct {
		id     string
		isBusy bool
	}
	var toUpdate []wndState
	for rows.Next() {
		var ws wndState
		if err := rows.Scan(&ws.id, &ws.isBusy); err != nil {
			return result, dbError(err)
		}
		toUpdate = append(toUpdate, ws)
	}
	if err := rows.Err(); err != nil {
		return result, dbError(err)
	}
	rows.Close()

	for _, ws := range toUpdate {
		if ws.isBusy {
			if _, err := tx.Exec(ctx, `UPDATE windows SET status='CLOSING' WHERE id=$1::uuid`, ws.id); err != nil {
				return result, dbError(err)
			}
			result.WindowsClosingCount++
		} else {
			if _, err := tx.Exec(ctx, `UPDATE windows SET status='CLOSED' WHERE id=$1::uuid`, ws.id); err != nil {
				return result, dbError(err)
			}
			result.WindowsClosedCount++
		}
	}

		ticketRows, err := tx.Query(ctx, `
		SELECT id::text, status
		FROM tickets
		WHERE branch_id = $1 AND status IN ('WAITING', 'SCHEDULED')
		FOR UPDATE
	`, id)
	if err != nil {
		return result, dbError(err)
	}
	defer ticketRows.Close()

	type uncalledTicket struct {
		id     string
		status domain.TicketStatus
	}
	var uncalled []uncalledTicket
	for ticketRows.Next() {
		var ut uncalledTicket
		if err := ticketRows.Scan(&ut.id, &ut.status); err == nil {
			uncalled = append(uncalled, ut)
		}
	}
	ticketRows.Close()

		for _, ut := range uncalled {
		if _, err := tx.Exec(ctx, `UPDATE tickets SET status='CANCELLED' WHERE id=$1::uuid`, ut.id); err != nil {
			return result, dbError(err)
		}
		from := ut.status
		dummyTicket := domain.Ticket{
			ID:     ut.id,
			Status: domain.TicketStatusCancelled,
		}
		if err := insertEvent(ctx, tx, dummyTicket, domain.TicketEventCancelled, &from, nil, nil); err != nil {
			return result, err
		}
		result.CancelledTicketsCount++
	}

	if err := tx.Commit(ctx); err != nil {
		return result, dbError(err)
	}

	return result, nil
}

// UpdateBranchSchedule sets the working hours for a branch to take effect starting from the next calendar day
// to avoid breaking active queues, feasibility calculations and scheduled appointments.
func (p *Postgres) UpdateBranchSchedule(ctx context.Context, branchID string, workHours string) (domain.Branch, error) {
	id, err := p.branch(ctx, branchID)
	if err != nil {
		return domain.Branch{}, err
	}

	cleanHours := strings.TrimSpace(workHours)
	if cleanHours == "" {
		return domain.Branch{}, fmt.Errorf("%w: workHours cannot be empty", application.ErrInvalidState)
	}

	var b domain.Branch
	var scheduledDate *time.Time
	err = p.pool.QueryRow(ctx, `
		UPDATE branches
		SET scheduled_work_hours = $2,
		    scheduled_work_hours_effective_date = ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date + interval '1 day')
		WHERE id = $1
		RETURNING id::text, name, address, work_hours, timezone_offset, scheduled_work_hours, scheduled_work_hours_effective_date
	`, id, cleanHours).Scan(&b.ID, &b.Name, &b.Address, &b.WorkHours, &b.TimezoneOffset, &b.ScheduledWorkHours, &scheduledDate)
	if err != nil {
		return domain.Branch{}, dbError(err)
	}
	if scheduledDate != nil {
		dStr := scheduledDate.Format("2006-01-02")
		b.ScheduledEffectiveDate = &dStr
	}
	return b, nil
}

// Branch-wide indicative estimate, not a service-specific promise or ticket ETA.
func estimateBranchWait(queued, windows int, averageSeconds float64) *int {
	if windows <= 0 {
		return nil
	}
	seconds := int(math.Ceil(float64(queued) * averageSeconds / float64(windows)))
	return &seconds
}

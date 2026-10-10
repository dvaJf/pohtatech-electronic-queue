package persistence

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

// SavePriorityRules persists priority rules for a branch using UPSERT.
func (p *Postgres) SavePriorityRules(ctx context.Context, branchID string, rules []domain.PriorityRule) error {
	id, err := p.branch(ctx, branchID)
	if err != nil {
		return err
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return dbError(err)
	}
	defer tx.Rollback(context.Background())

	// Delete existing rules and replace — simpler than UPSERT with variable source list.
	if _, err = tx.Exec(ctx, `DELETE FROM priority_rules WHERE branch_id = $1`, id); err != nil {
		return dbError(err)
	}
	for _, r := range rules {
		_, err = tx.Exec(ctx,
			`INSERT INTO priority_rules(branch_id, source, name, weight, max_wait_limit_minutes, description)
			 VALUES($1, $2, $3, $4, $5, $6)`,
			id, string(r.Source), r.Name, r.Weight, r.MaxWaitLimitMinutes, r.Description,
		)
		if err != nil {
			return dbError(err)
		}
	}
	return dbError(tx.Commit(ctx))
}

// GetAdminOverview aggregates metrics, windows, queue, priorities and anomalies in
// a minimal number of round-trips (no N+1 loops).
func (p *Postgres) GetAdminOverview(ctx context.Context, branchID string) (domain.AdminBranchOverview, error) {
	var overview domain.AdminBranchOverview
	overview.BranchID = branchID

	id, err := p.branch(ctx, branchID)
	if err != nil {
		return overview, err
	}

		if err = p.pool.QueryRow(ctx, `SELECT name FROM branches WHERE id=$1`, id).Scan(&overview.BranchName); err != nil {
		return overview, dbError(err)
	}

	// Quality is scoped to this branch and uses feedback timestamps for the two
	// adjacent 30-day windows. FILTER keeps this one aggregate round-trip.
	q := domain.BranchQuality{Distribution: map[string]int{"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}, RecentFeedback: []domain.RecentFeedback{}}
	var one, two, three, four, five int
	err = p.pool.QueryRow(ctx, `
		SELECT AVG(f.rating)::double precision, COUNT(f.id),
		 AVG(f.rating) FILTER (WHERE f.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days')::double precision,
		 COUNT(f.id) FILTER (WHERE f.created_at >= CURRENT_TIMESTAMP - INTERVAL '30 days'),
		 AVG(f.rating) FILTER (WHERE f.created_at >= CURRENT_TIMESTAMP - INTERVAL '60 days' AND f.created_at < CURRENT_TIMESTAMP - INTERVAL '30 days')::double precision,
		 COUNT(f.id) FILTER (WHERE f.created_at >= CURRENT_TIMESTAMP - INTERVAL '60 days' AND f.created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'),
		 COUNT(f.id) FILTER (WHERE f.rating=1), COUNT(f.id) FILTER (WHERE f.rating=2), COUNT(f.id) FILTER (WHERE f.rating=3), COUNT(f.id) FILTER (WHERE f.rating=4), COUNT(f.id) FILTER (WHERE f.rating=5),
		 COUNT(f.id) FILTER (WHERE f.rating <= 2)
		FROM tickets t JOIN ticket_feedback f ON f.ticket_id=t.id WHERE t.branch_id=$1 AND t.status='COMPLETED'`, id).Scan(
		&q.RatingAverage, &q.RatingCount, &q.Current30Average, &q.Current30Count, &q.Previous30Average, &q.Previous30Count,
		&one, &two, &three, &four, &five, &q.LowRatingCount)
	if err != nil {
		return overview, dbError(err)
	}
	q.Distribution["1"], q.Distribution["2"], q.Distribution["3"], q.Distribution["4"], q.Distribution["5"] = one, two, three, four, five
	if q.Current30Average != nil && q.Previous30Average != nil {
		delta := *q.Current30Average - *q.Previous30Average
		q.Delta = &delta
	}
	rowsFeedback, err := p.pool.Query(ctx, `SELECT f.rating, f.comment, f.created_at FROM tickets t JOIN ticket_feedback f ON f.ticket_id=t.id WHERE t.branch_id=$1 AND t.status='COMPLETED' AND f.comment <> '' ORDER BY f.created_at DESC LIMIT 5`, id)
	if err != nil {
		return overview, dbError(err)
	}
	for rowsFeedback.Next() {
		var f domain.RecentFeedback
		if err = rowsFeedback.Scan(&f.Rating, &f.Comment, &f.CreatedAt); err != nil {
			rowsFeedback.Close()
			return overview, dbError(err)
		}
		q.RecentFeedback = append(q.RecentFeedback, f)
	}
	if err = rowsFeedback.Err(); err != nil {
		rowsFeedback.Close()
		return overview, dbError(err)
	}
	rowsFeedback.Close()
	overview.Quality = q

			err = p.pool.QueryRow(ctx, `
		SELECT
			COUNT(CASE WHEN status = 'WAITING' OR (status = 'SCHEDULED' AND (arrived_at IS NOT NULL OR scheduled_at <= NOW())) THEN 1 END),
			COUNT(CASE WHEN status = 'COMPLETED' AND (queue_entered_at AT TIME ZONE 'Europe/Moscow')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date THEN 1 END),
			COALESCE((
				AVG(EXTRACT(EPOCH FROM (called_at - queue_entered_at)) / 60)
				FILTER (WHERE called_at IS NOT NULL AND (queue_entered_at AT TIME ZONE 'Europe/Moscow')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date)
			)::int, 0),
			COALESCE((
				MAX(EXTRACT(EPOCH FROM (called_at - queue_entered_at)) / 60)
				FILTER (WHERE called_at IS NOT NULL AND (queue_entered_at AT TIME ZONE 'Europe/Moscow')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date)
			)::int, 0),
			percentile_cont(0.9) WITHIN GROUP (ORDER BY (EXTRACT(EPOCH FROM (NOW() - COALESCE(arrived_at, queue_entered_at, scheduled_at))) / 60)::double precision)
			FILTER (WHERE status = 'WAITING' OR (status = 'SCHEDULED' AND (arrived_at IS NOT NULL OR scheduled_at <= NOW())))
		FROM tickets
		WHERE branch_id = $1
	`, id).Scan(
		&overview.Metrics.WaitingClientsCount,
		&overview.Metrics.ServedTodayCount,
		&overview.Metrics.AvgWaitTimeMinutes,
		&overview.Metrics.MaxWaitTimeMinutes,
		&overview.Metrics.P90WaitMinutes,
	)
	if err != nil {
		return overview, dbError(err)
	}

		if err = p.pool.QueryRow(ctx, `
		SELECT
			COUNT(CASE WHEN status = 'OPEN' THEN 1 END),
			COUNT(*)
		FROM windows
		WHERE branch_id = $1
	`, id).Scan(&overview.Metrics.ActiveWindowsCount, &overview.Metrics.TotalWindowsCount); err != nil {
		return overview, dbError(err)
	}

		windows, err := p.ListBranchWindows(ctx, branchID)
	if err != nil {
		return overview, err
	}

			type activeTicket struct {
		publicNumber string
		serviceName  string
	}
	activeTickets := make(map[string]activeTicket)

	rows, err := p.pool.Query(ctx, `
		SELECT t.window_id::text, t.public_number, s.name
		FROM tickets t
		JOIN services s ON s.id = t.service_id
		WHERE t.branch_id = $1 AND t.status IN ('CALLED', 'SERVING')
	`, id)
	if err != nil {
		return overview, dbError(err)
	}
	func() {
		defer rows.Close()
		for rows.Next() {
			var wid, pub, svc string
			if scanErr := rows.Scan(&wid, &pub, &svc); scanErr == nil {
				activeTickets[wid] = activeTicket{publicNumber: pub, serviceName: svc}
			}
		}
	}()
	if err = rows.Err(); err != nil {
		return overview, dbError(err)
	}

		servedByWindow := make(map[string]int)
	rows2, err := p.pool.Query(ctx, `
		SELECT window_id::text, COUNT(*)
		FROM tickets
		WHERE branch_id = $1 AND status = 'COMPLETED' AND (queue_entered_at AT TIME ZONE 'Europe/Moscow')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date
		  AND window_id IS NOT NULL
		GROUP BY window_id
	`, id)
	if err != nil {
		return overview, dbError(err)
	}
	func() {
		defer rows2.Close()
		for rows2.Next() {
			var wid string
			var cnt int
			if scanErr := rows2.Scan(&wid, &cnt); scanErr == nil {
				servedByWindow[wid] = cnt
			}
		}
	}()
	if err = rows2.Err(); err != nil {
		return overview, dbError(err)
	}

		overview.Windows = make([]domain.AdminWindow, 0, len(windows))
	for _, w := range windows {
		aw := domain.AdminWindow{
			ID:          w.ID,
			Number:      w.Number,
			Status:      w.Status,
			Services:    w.Services,
			ServedCount: servedByWindow[w.ID],
		}
		if at, ok := activeTickets[w.ID]; ok {
			aw.CurrentTicketNumber = &at.publicNumber
			aw.CurrentService = &at.serviceName
		}
		overview.Windows = append(overview.Windows, aw)
	}
	p.calculateWindowRecommendation(ctx, branchID, &overview)

		qrows, err := p.pool.Query(ctx, `
		SELECT t.id::text, t.public_number, t.source, t.service_id::text, s.name, t.queue_entered_at, t.status,
			   EXTRACT(EPOCH FROM (NOW() - t.queue_entered_at)) / 60
		FROM tickets t
		JOIN services s ON s.id = t.service_id
		WHERE t.branch_id = $1 AND (
			t.status IN ('WAITING', 'CALLED', 'SERVING')
			OR (t.status = 'SCHEDULED' AND (t.scheduled_at AT TIME ZONE 'Europe/Moscow')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date AND (t.scheduled_at <= NOW() + INTERVAL '15 minutes' OR t.arrived_at IS NOT NULL))
		)
		ORDER BY t.queue_entered_at ASC
	`, id)
	if err != nil {
		return overview, dbError(err)
	}
	defer qrows.Close()

	overview.Queue = make([]domain.AdminQueueTicket, 0)
	overview.Anomalies = make([]domain.AnomalyTicket, 0)

	for qrows.Next() {
		var qt domain.AdminQueueTicket
		var waitTime float64
		if err = qrows.Scan(&qt.ID, &qt.PublicNumber, &qt.Source, &qt.ServiceID, &qt.ServiceName, &qt.QueueEnteredAt, &qt.Status, &waitTime); err != nil {
			return overview, dbError(err)
		}
		qt.WaitTimeMinutes = int(waitTime)
		overview.Queue = append(overview.Queue, qt)

				if qt.Status == domain.TicketStatusWaiting && qt.WaitTimeMinutes > 15 {
			overview.Anomalies = append(overview.Anomalies, domain.AnomalyTicket{
				ID:              qt.ID,
				PublicNumber:    qt.PublicNumber,
				Type:            domain.AnomalyExceededWait,
				Description:     "Превышено максимальное время ожидания",
				Time:            qt.QueueEnteredAt,
				DurationMinutes: qt.WaitTimeMinutes,
			})
		}
	}
	if err = qrows.Err(); err != nil {
		return overview, dbError(err)
	}

		nsRows, err := p.pool.Query(ctx, `
		SELECT id::text, public_number, no_show_at
		FROM tickets
		WHERE branch_id = $1 AND status = 'NO_SHOW' AND (queue_entered_at AT TIME ZONE 'Europe/Moscow')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date
		ORDER BY no_show_at DESC
		LIMIT 10
	`, id)
	if err == nil {
		defer nsRows.Close()
		for nsRows.Next() {
			var tid, pub string
			var nsTime *time.Time
			if scanErr := nsRows.Scan(&tid, &pub, &nsTime); scanErr == nil {
				tVal := time.Now()
				if nsTime != nil {
					tVal = *nsTime
				}
				overview.Anomalies = append(overview.Anomalies, domain.AnomalyTicket{
					ID:           tid,
					PublicNumber: pub,
					Type:         domain.AnomalyNoShow,
					Description:  "Клиент не явился к окну оператора",
					Time:         tVal,
				})
			}
		}
	}

		incRows, err := p.pool.Query(ctx, `
		SELECT oi.id::text, COALESCE('Окно ' || w.number::text, 'СБОЙ'), oi.category || ': ' || oi.description, oi.created_at,
		       GREATEST(0, EXTRACT(EPOCH FROM (NOW() - oi.created_at)) / 60)::int
		FROM operator_incidents oi
		LEFT JOIN windows w ON w.id = oi.window_id
		WHERE oi.branch_id = $1
		ORDER BY oi.created_at DESC
		LIMIT 10
	`, id)
	if err == nil {
		defer incRows.Close()
		for incRows.Next() {
			var iid, pub, desc string
			var iTime time.Time
			var dur int
			if scanErr := incRows.Scan(&iid, &pub, &desc, &iTime, &dur); scanErr == nil {
				overview.Anomalies = append(overview.Anomalies, domain.AnomalyTicket{
					ID:              iid,
					PublicNumber:    pub,
					Type:            domain.AnomalyTechIssue,
					Description:     desc,
					Time:            iTime,
					DurationMinutes: dur,
				})
			}
		}
	}

		overview.Priorities, err = p.loadPriorityRules(ctx, id)
	if err != nil {
		return overview, err
	}

	return overview, nil
}

func (p *Postgres) ListAnomalies(ctx context.Context, branchID string, limit, offset int) (domain.AnomalyPage, error) {
	var page domain.AnomalyPage
	id, err := p.branch(ctx, branchID)
	if err != nil {
		return page, err
	}

	var ticketCount, incidentCount int
	const anomalyFilter = `branch_id = $1 AND (
		(status = 'WAITING' AND queue_entered_at < NOW() - INTERVAL '15 minutes')
		OR (status = 'NO_SHOW' AND (queue_entered_at AT TIME ZONE 'Europe/Moscow')::date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date)
	)`
	err = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM tickets WHERE `+anomalyFilter, id).Scan(&ticketCount)
	if err != nil {
		return page, dbError(err)
	}

	_ = p.pool.QueryRow(ctx, `SELECT COUNT(*) FROM operator_incidents WHERE branch_id = $1`, id).Scan(&incidentCount)
	page.Total = ticketCount + incidentCount

	rows, err := p.pool.Query(ctx, `
		SELECT id, public_number, type, description, event_time, duration_minutes FROM (
			SELECT 
				t.id::text AS id,
				t.public_number AS public_number,
				CASE WHEN t.status = 'NO_SHOW' THEN 'NO_SHOW' ELSE 'EXCEEDED_WAIT' END AS type,
				CASE WHEN t.status = 'NO_SHOW' THEN 'Клиент не явился к окну оператора' ELSE 'Превышено максимальное время ожидания' END AS description,
				COALESCE(t.no_show_at, t.queue_entered_at) AS event_time,
				CASE WHEN t.status = 'NO_SHOW' THEN 0 ELSE GREATEST(0, EXTRACT(EPOCH FROM (NOW() - t.queue_entered_at)) / 60)::int END AS duration_minutes
			FROM tickets t
			WHERE `+anomalyFilter+`
			UNION ALL
			SELECT 
				oi.id::text AS id,
				COALESCE('Окно ' || w.number::text, 'СБОЙ') AS public_number,
				'TECH_ISSUE' AS type,
				oi.category || ': ' || oi.description AS description,
				oi.created_at AS event_time,
				GREATEST(0, EXTRACT(EPOCH FROM (NOW() - oi.created_at)) / 60)::int AS duration_minutes
			FROM operator_incidents oi
			LEFT JOIN windows w ON w.id = oi.window_id
			WHERE oi.branch_id = $1
		) combined
		ORDER BY event_time DESC, id DESC
		LIMIT $2 OFFSET $3`, id, limit, offset)
	if err != nil {
		return page, dbError(err)
	}
	defer rows.Close()
	page.Items = make([]domain.AnomalyTicket, 0, limit)
	for rows.Next() {
		var item domain.AnomalyTicket
		var anomType string
		if err = rows.Scan(&item.ID, &item.PublicNumber, &anomType, &item.Description, &item.Time, &item.DurationMinutes); err != nil {
			return page, dbError(err)
		}
		item.Type = domain.AnomalyType(anomType)
		page.Items = append(page.Items, item)
	}
	return page, dbError(rows.Err())
}

// loadPriorityRules reads persisted rules; falls back to defaults if none exist.
func (p *Postgres) loadPriorityRules(ctx context.Context, id pgtype.UUID) ([]domain.PriorityRule, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT source, name, weight, max_wait_limit_minutes, description
		FROM priority_rules
		WHERE branch_id = $1
		ORDER BY weight DESC, source
	`, id)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()

	var rules []domain.PriorityRule
	for rows.Next() {
		var r domain.PriorityRule
		if err = rows.Scan(&r.Source, &r.Name, &r.Weight, &r.MaxWaitLimitMinutes, &r.Description); err != nil {
			return nil, dbError(err)
		}
		rules = append(rules, r)
	}
	if err = rows.Err(); err != nil {
		return nil, dbError(err)
	}

	// Fallback to hardcoded defaults if branch has no rules yet
	if len(rules) == 0 {
		rules = defaultPriorityRules()
	}
	return rules, nil
}

func defaultPriorityRules() []domain.PriorityRule {
	return []domain.PriorityRule{
		{Source: "APPOINTMENT", Name: "Предварительная запись", Weight: 100, MaxWaitLimitMinutes: 5, Description: "Обслуживаются первыми по времени"},
		{Source: "QR", Name: "QR-код", Weight: 50, MaxWaitLimitMinutes: 15, Description: "Живая очередь по коду в отделении"},
		{Source: "LIVE", Name: "Живая очередь", Weight: 10, MaxWaitLimitMinutes: 30, Description: "Талоны от оператора"},
	}
}

// renumberBranchWindowsTx renumbers all windows of a branch sequentially (1..N)
// safely handling the UNIQUE (branch_id, number) constraint by shifting numbers first.
func renumberBranchWindowsTx(ctx context.Context, tx pgx.Tx, bid pgtype.UUID) error {
		if _, err := tx.Exec(ctx, `
		UPDATE windows 
		SET number = number + 100000 
		WHERE branch_id = $1`, bid); err != nil {
		return dbError(err)
	}

		if _, err := tx.Exec(ctx, `
		WITH ordered AS (
			SELECT id, ROW_NUMBER() OVER (ORDER BY number ASC) AS new_num
			FROM windows
			WHERE branch_id = $1
		)
		UPDATE windows w
		SET number = o.new_num
		FROM ordered o
		WHERE w.id = o.id`, bid); err != nil {
		return dbError(err)
	}

	return nil
}

// CreateWindow creates a new window in the branch and assigns default branch services.
func (p *Postgres) CreateWindow(ctx context.Context, branchID string) (domain.Window, error) {
	var empty domain.Window
	bid, err := uuid(branchID)
	if err != nil {
		return empty, err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(context.Background())

	// Normalize any existing windows first to prevent gaps
	if err := renumberBranchWindowsTx(ctx, tx, bid); err != nil {
		return empty, err
	}

	var maxNumber int
	err = tx.QueryRow(ctx, `SELECT COALESCE(MAX(number), 0) + 1 FROM windows WHERE branch_id = $1`, bid).Scan(&maxNumber)
	if err != nil {
		return empty, dbError(err)
	}

	var newID string
	err = tx.QueryRow(ctx, `INSERT INTO windows (id, branch_id, number, status)
		VALUES (gen_random_uuid(), $1, $2, 'CLOSED')
		RETURNING id::text`, bid, maxNumber).Scan(&newID)
	if err != nil {
		return empty, dbError(err)
	}

	// Assign all branch services as default capabilities
	_, err = tx.Exec(ctx, `INSERT INTO window_services (window_id, branch_id, service_id)
		SELECT $1::uuid, $2, service_id FROM branch_services WHERE branch_id = $2`, newID, bid)
	if err != nil {
		return empty, dbError(err)
	}

	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}

	windows, err := p.ListBranchWindows(ctx, branchID)
	if err != nil {
		return empty, err
	}
	for _, w := range windows {
		if w.ID == newID {
			return w, nil
		}
	}
	return domain.Window{ID: newID, BranchID: branchID, Number: maxNumber, Status: domain.WindowStatusClosed}, nil
}

// DeleteWindow removes a window if it has no active tickets and renumbers remaining windows sequentially.
func (p *Postgres) DeleteWindow(ctx context.Context, windowID string) error {
	wid, err := uuid(windowID)
	if err != nil {
		return err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return dbError(err)
	}
	defer tx.Rollback(context.Background())

	var branchID string
	var deletedNum int
	err = tx.QueryRow(ctx, `SELECT branch_id::text, number FROM windows WHERE id = $1`, wid).Scan(&branchID, &deletedNum)
	if err != nil {
		return dbError(err)
	}

	var hasActive bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickets WHERE window_id=$1 AND status IN ('CALLED', 'SERVING'))`, wid).Scan(&hasActive)
	if err != nil {
		return dbError(err)
	}
	if hasActive {
		return fmt.Errorf("cannot delete window with active ticket: %w", application.ErrWindowBusy)
	}

		if _, err = tx.Exec(ctx, `DELETE FROM window_services WHERE window_id=$1`, wid); err != nil {
		return dbError(err)
	}

		res, err := tx.Exec(ctx, `DELETE FROM windows WHERE id=$1`, wid)
	if err != nil {
		return dbError(err)
	}
	if res.RowsAffected() == 0 {
		return application.ErrNotFound
	}

		bid, err := uuid(branchID)
	if err != nil {
		return err
	}
	if err := renumberBranchWindowsTx(ctx, tx, bid); err != nil {
		return err
	}

	return dbError(tx.Commit(ctx))
}

func (p *Postgres) ReportIncident(ctx context.Context, cmd application.ReportIncidentCommand) (domain.OperatorIncident, error) {
	var res domain.OperatorIncident
	branchID, err := uuid(cmd.BranchID)
	if err != nil {
		return res, application.ErrNotFound
	}
	if cmd.Category == "" || cmd.Description == "" {
		return res, application.ErrInvalidState
	}

	var winID *pgtype.UUID
	if cmd.WindowID != nil && *cmd.WindowID != "" {
		w, err := uuid(*cmd.WindowID)
		if err == nil {
			winID = &w
		}
	}

	var opID *pgtype.UUID
	if cmd.OperatorID != nil && *cmd.OperatorID != "" {
		o, err := uuid(*cmd.OperatorID)
		if err == nil {
			opID = &o
		}
	}

	var id string
	var createdAt time.Time
	err = p.pool.QueryRow(ctx, `
		INSERT INTO operator_incidents (branch_id, window_id, operator_id, category, description, created_at)
		VALUES ($1, $2, $3, $4, $5, clock_timestamp())
		RETURNING id::text, created_at
	`, branchID, winID, opID, cmd.Category, cmd.Description).Scan(&id, &createdAt)
	if err != nil {
		return res, dbError(err)
	}

	res = domain.OperatorIncident{
		ID:          id,
		BranchID:    cmd.BranchID,
		WindowID:    cmd.WindowID,
		OperatorID:  cmd.OperatorID,
		Category:    cmd.Category,
		Description: cmd.Description,
		CreatedAt:   createdAt,
	}
	return res, nil
}

func formatWindowsRu(n int) string {
	absN := n % 100
	if absN >= 11 && absN <= 19 {
		return fmt.Sprintf("%d окон", n)
	}
	switch absN % 10 {
	case 1:
		return fmt.Sprintf("%d окно", n)
	case 2, 3, 4:
		return fmt.Sprintf("%d окна", n)
	default:
		return fmt.Sprintf("%d окон", n)
	}
}

// calculateWindowRecommendation determines how many service windows should be opened or created
// based on current queue load (waiting clients, SLA wait times) and statistical workload in the nearest hour.
func (p *Postgres) calculateWindowRecommendation(ctx context.Context, branchID string, overview *domain.AdminBranchOverview) {
	closedCount := 0
	for _, window := range overview.Windows {
		if window.Status == domain.WindowStatusClosed {
			closedCount++
		}
	}

	waitingCount := overview.Metrics.WaitingClientsCount
	openCount := overview.Metrics.ActiveWindowsCount
	totalCount := overview.Metrics.TotalWindowsCount
	if totalCount <= 0 {
		totalCount = len(overview.Windows)
	}

	var p90 float64
	hasP90 := false
	if overview.Metrics.P90WaitMinutes != nil {
		p90 = *overview.Metrics.P90WaitMinutes
		hasP90 = true
	}
	avgWait := float64(overview.Metrics.AvgWaitTimeMinutes)

		windowsForCurrent := 0
	if waitingCount > 0 {
		targetForQueue := int(math.Ceil(float64(waitingCount) / 2.5))
		if targetForQueue > openCount {
			windowsForCurrent = targetForQueue - openCount
		}
		if hasP90 && p90 > 12.0 {
			p90Deficit := int(math.Ceil((p90 - 10.0) / 5.0))
			if p90Deficit > windowsForCurrent {
				windowsForCurrent = p90Deficit
			}
		}
		if avgWait > 8.0 && waitingCount > openCount*2 {
			waitDeficit := int(math.Ceil(float64(waitingCount-openCount) / 2.0))
			if waitDeficit > windowsForCurrent {
				windowsForCurrent = waitDeficit
			}
		}
	}

		windowsForUpcoming := 0
	var upcomingWorkload *domain.HourlyWorkload
	if p.pool != nil {
		if wl, err := p.GetBranchWorkload(ctx, branchID); err == nil {
			nowMSK := time.Now().In(time.FixedZone("MSK", 3*3600))
			currHour := nowMSK.Hour()
			nextHour := currHour + 1
			if nextHour > 21 {
				nextHour = currHour
			}
			if nextHour < 8 {
				nextHour = 8
			}

			for i := range wl.Hourly {
				if wl.Hourly[i].Hour == nextHour {
					upcomingWorkload = &wl.Hourly[i]
					break
				}
			}
			if upcomingWorkload == nil {
				for i := range wl.Hourly {
					if wl.Hourly[i].Hour == currHour {
						upcomingWorkload = &wl.Hourly[i]
						break
					}
				}
			}

			if upcomingWorkload != nil {
				loadPct := upcomingWorkload.LoadPercent
				waitMin := upcomingWorkload.WaitMinutes

				targetStat := int(math.Round(float64(totalCount) * float64(loadPct) / 100.0))
				if upcomingWorkload.IsPeak && targetStat < int(math.Ceil(float64(totalCount)*0.7)) {
					targetStat = int(math.Ceil(float64(totalCount) * 0.7))
				}
				if waitMin > 12 {
					statDeficit := int(math.Ceil(float64(waitMin-10) / 5.0))
					if openCount+statDeficit > targetStat {
						targetStat = openCount + statDeficit
					}
				}
				if targetStat > openCount {
					windowsForUpcoming = targetStat - openCount
				}
			}
		}
	}

		if windowsForCurrent == 0 && windowsForUpcoming == 0 {
		return
	}

	recommended := windowsForCurrent
	if windowsForUpcoming > recommended {
		recommended = windowsForUpcoming
	}
	if windowsForCurrent >= 1 && windowsForUpcoming >= 1 && closedCount > 0 && recommended < closedCount {
		recommended++
	}

	isCreateRecommendation := closedCount == 0 || recommended > closedCount
	if closedCount > 0 && recommended > closedCount {
		recommended = closedCount
	} else if closedCount == 0 {
		// Cap window creation recommendation:
		// Target active windows = Ceil(waitingCount / 2.5) or at least openCount + 1
		// If openCount is already sufficient to keep wait under SLA (e.g. queue <= openCount * 2.5), do NOT recommend creating more windows indefinitely!
		targetNeededTotal := int(math.Ceil(float64(waitingCount) / 2.5))
		if targetNeededTotal <= openCount {
			// Current open windows are already enough for the queue!
			return
		}
		createNeeded := targetNeededTotal - openCount
		if createNeeded > 2 {
			createNeeded = 2 // Recommend at most 2 new windows at once
		}
		if createNeeded < 1 {
			return
		}
		recommended = createNeeded
	}

	if recommended < 1 {
		return
	}

		severity := "warning"
	if (hasP90 && p90 > 15.0 && waitingCount > openCount) ||
		(waitingCount >= openCount*3 && waitingCount > 3) ||
		(upcomingWorkload != nil && upcomingWorkload.LoadPercent >= 80 && openCount <= totalCount/2) {
		severity = "critical"
	}

	var reason string
	recText := formatWindowsRu(recommended)
	if isCreateRecommendation && closedCount == 0 {
		if windowsForCurrent > 0 {
			reason = fmt.Sprintf("Все %d окон отделения уже открыты, но в очереди %d чел. — рекомендуем создать и открыть еще %s", totalCount, waitingCount, recText)
		} else if upcomingWorkload != nil {
			reason = fmt.Sprintf("Все %d окон отделения открыты, а прогноз нагрузки на след. час — %d%% — рекомендуем создать и открыть еще %s заранее", totalCount, upcomingWorkload.LoadPercent, recText)
		} else {
			reason = fmt.Sprintf("Все %d окон открыты — рекомендуем создать и открыть еще %s для снятия нагрузки", totalCount, recText)
		}
	} else if windowsForCurrent > 0 && upcomingWorkload != nil {
		if hasP90 && p90 > 12.0 {
			reason = fmt.Sprintf("Текущая очередь: %d чел. (P90=%.0f мин > SLA 12), прогноз нагрузки на след. час: %d%% — рекомендуем открыть %s", waitingCount, p90, upcomingWorkload.LoadPercent, recText)
		} else {
			reason = fmt.Sprintf("Текущая очередь: %d чел., прогноз нагрузки на след. час: %d%% — рекомендуем открыть %s для соблюдения SLA 12 мин", waitingCount, upcomingWorkload.LoadPercent, recText)
		}
	} else if windowsForCurrent > 0 {
		if hasP90 && p90 > 12.0 {
			reason = fmt.Sprintf("P90=%.0f мин > SLA 12 (в очереди %d чел.) при %d откр. окнах — рекомендуем открыть %s", p90, waitingCount, openCount, recText)
		} else {
			reason = fmt.Sprintf("Высокая текущая очередь: %d чел. на %d откр. окон — рекомендуем открыть %s для соблюдения SLA 12 мин", waitingCount, openCount, recText)
		}
	} else if upcomingWorkload != nil {
		if upcomingWorkload.IsPeak || upcomingWorkload.WaitMinutes > 12 {
			reason = fmt.Sprintf("Прогноз пиковой нагрузки в ближайший час: %d%% (ожидание до %d мин > SLA 12) — рекомендуем открыть %s заранее", upcomingWorkload.LoadPercent, upcomingWorkload.WaitMinutes, recText)
		} else {
			reason = fmt.Sprintf("Прогноз роста нагрузки в ближайший час: %d%% (при %d откр. окнах) — рекомендуем открыть %s заранее", upcomingWorkload.LoadPercent, openCount, recText)
		}
	} else {
		reason = fmt.Sprintf("Рекомендуем открыть %s для распределения нагрузки отделения", recText)
	}

	p90Val := p90
	if !hasP90 && upcomingWorkload != nil {
		p90Val = float64(upcomingWorkload.WaitMinutes)
	}

	overview.WindowRecommendation = &domain.WindowRecommendation{
		RecommendedCount:    recommended,
		Reason:              reason,
		Severity:            severity,
		P90WaitMinutes:      p90Val,
		UpcomingLoadPercent: func() int { if upcomingWorkload != nil { return upcomingWorkload.LoadPercent }; return 0 }(),
		WaitingClientsCount: waitingCount,
	}
}


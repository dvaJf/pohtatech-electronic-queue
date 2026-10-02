// Package persistence implements the application boundary using PostgreSQL.
package persistence

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

type Postgres struct {
	pool      *pgxpool.Pool
	policyMu  sync.RWMutex
	policy    domain.QueuePolicyConfig
	predictor application.ETAPredictor
}

func New(pool *pgxpool.Pool, policy ...domain.QueuePolicyConfig) *Postgres {
	p := domain.DefaultQueuePolicy()
	if len(policy) > 0 {
		p = policy[0]
	}
	return &Postgres{pool: pool, policy: p}
}

func (p *Postgres) SetPolicy(cfg domain.QueuePolicyConfig) {
	p.policyMu.Lock()
	defer p.policyMu.Unlock()
	p.policy = cfg.Clone()
}

func (p *Postgres) GetPolicy() domain.QueuePolicyConfig {
	p.policyMu.RLock()
	defer p.policyMu.RUnlock()
	return p.policy.Clone()
}

func (p *Postgres) SetETAPredictor(predictor application.ETAPredictor) { p.predictor = predictor }

var _ application.UseCases = (*Postgres)(nil)

// UUID parsing stays private to persistence. Invalid resource IDs are not found.
func uuid(s string) (pgtype.UUID, error) {
	var id pgtype.UUID
	if err := id.Scan(s); err != nil || !id.Valid {
		return id, application.ErrNotFound
	}
	return id, nil
}
func dbError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return application.ErrNotFound
	}
	if errors.Is(err, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "tickets_one_active_per_window" {
		return application.ErrWindowBusy
	}
	// Do not expose driver messages, SQL or connection details across the boundary.
	slog.Error("persistence error", "err", err)
	return errors.New("queue persistence operation failed")
}

const ticketColumns = `t.id::text, t.public_number, t.branch_id::text, t.service_id::text,
 t.source, t.status, w.id::text, w.number, t.created_at, t.queue_entered_at,
 t.called_at, t.service_started_at, t.completed_at, t.scheduled_at, t.arrived_at, t.no_show_at,
 t.checkin_at, t.ready_at, t.due_at, t.source_rank, t.policy_version, t.recall_count, t.client_id,
 COALESCE(s.name, '')`
const ticketSelect = `SELECT ` + ticketColumns + ` FROM tickets t LEFT JOIN windows w ON w.id=t.window_id LEFT JOIN services s ON s.id=t.service_id `

func scanTicket(row pgx.Row) (domain.Ticket, error) {
	var t domain.Ticket
	var wid *string
	var number *int
	err := row.Scan(
		&t.ID, &t.PublicNumber, &t.BranchID, &t.ServiceID, &t.Source, &t.Status,
		&wid, &number, &t.CreatedAt, &t.QueueEnteredAt,
		&t.CalledAt, &t.ServiceStartedAt, &t.CompletedAt, &t.ScheduledAt, &t.ArrivedAt, &t.NoShowAt,
		&t.CheckinAt, &t.ReadyAt, &t.DueAt, &t.SourceRank, &t.PolicyVersion, &t.RecallCount, &t.ClientID,
		&t.ServiceName,
	)
	if err != nil {
		return domain.Ticket{}, dbError(err)
	}
	if wid != nil {
		t.Window = &domain.WindowRef{ID: *wid, Number: *number}
	}
	t.CreatedAt = t.CreatedAt.UTC()
	t.QueueEnteredAt = t.QueueEnteredAt.UTC()
	for _, v := range []*time.Time{t.CalledAt, t.ServiceStartedAt, t.CompletedAt, t.ScheduledAt, t.ArrivedAt, t.NoShowAt, t.CheckinAt, t.ReadyAt, t.DueAt} {
		if v != nil {
			*v = v.UTC()
		}
	}
	return t, nil
}
func (p *Postgres) ListBranches(ctx context.Context) ([]domain.Branch, error) {
	rows, err := p.pool.Query(ctx, `SELECT b.id::text,b.name,b.address,b.work_hours,b.timezone_offset,b.latitude,b.longitude,b.is_demo,AVG(f.rating)::double precision,COUNT(f.id)
		FROM branches b LEFT JOIN tickets t ON t.branch_id=b.id AND t.status='COMPLETED' LEFT JOIN ticket_feedback f ON f.ticket_id=t.id
		GROUP BY b.id,b.name,b.address,b.work_hours,b.timezone_offset,b.latitude,b.longitude,b.is_demo ORDER BY b.name,b.id`)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()
	out := []domain.Branch{}
	for rows.Next() {
		var b domain.Branch
		if err = rows.Scan(&b.ID, &b.Name, &b.Address, &b.WorkHours, &b.TimezoneOffset, &b.Latitude, &b.Longitude, &b.IsDemo, &b.RatingAverage, &b.RatingCount); err != nil {
			return nil, dbError(err)
		}
		out = append(out, b)
	}
	return out, dbError(rows.Err())
}
func (p *Postgres) branch(ctx context.Context, branchID string) (pgtype.UUID, error) {
	id, err := uuid(branchID)
	if err != nil {
		return id, err
	}
	var exists bool
	err = p.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM branches WHERE id=$1)`, id).Scan(&exists)
	if err != nil {
		return id, dbError(err)
	}
	if !exists {
		return id, application.ErrNotFound
	}
	return id, nil
}
func (p *Postgres) ListBranchServices(ctx context.Context, branchID string) ([]domain.Service, error) {
	id, err := p.branch(ctx, branchID)
	if err != nil {
		return nil, err
	}
	rows, err := p.pool.Query(ctx, `SELECT s.id::text,s.code,s.name FROM services s JOIN branch_services bs ON bs.service_id=s.id WHERE bs.branch_id=$1 ORDER BY s.code,s.id`, id)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()
	out := []domain.Service{}
	for rows.Next() {
		var s domain.Service
		if err = rows.Scan(&s.ID, &s.Code, &s.Name); err != nil {
			return nil, dbError(err)
		}
		out = append(out, s)
	}
	return out, dbError(rows.Err())
}
func (p *Postgres) ListBranchWindows(ctx context.Context, branchID string) ([]domain.Window, error) {
	id, err := p.branch(ctx, branchID)
	if err != nil {
		return nil, err
	}
	rows, err := p.pool.Query(ctx, `SELECT w.id::text,w.branch_id::text,w.number,w.status,s.id::text,s.code,s.name
 FROM windows w LEFT JOIN window_services ws ON ws.window_id=w.id LEFT JOIN services s ON s.id=ws.service_id
 WHERE w.branch_id=$1 ORDER BY w.number,w.id,s.code`, id)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()
	out := []domain.Window{}
	for rows.Next() {
		var w domain.Window
		var sid, code, name *string
		if err = rows.Scan(&w.ID, &w.BranchID, &w.Number, &w.Status, &sid, &code, &name); err != nil {
			return nil, dbError(err)
		}
		if len(out) == 0 || out[len(out)-1].ID != w.ID {
			w.Services = []domain.Service{}
			out = append(out, w)
		}
		if sid != nil {
			i := len(out) - 1
			out[i].Services = append(out[i].Services, domain.Service{ID: *sid, Code: *code, Name: *name})
		}
	}
	return out, dbError(rows.Err())
}
func (p *Postgres) GetTicket(ctx context.Context, ticketID string) (domain.Ticket, error) {
	id, err := uuid(ticketID)
	if err != nil {
		clean := strings.TrimSpace(ticketID)
		return scanTicket(p.pool.QueryRow(ctx, ticketSelect+`WHERE (UPPER(t.public_number)=UPPER($1) OR UPPER(t.public_number)=UPPER('A-' || $1) OR UPPER(t.public_number)=UPPER('A-' || LPAD($1, 6, '0')))`, clean))
	}
	return scanTicket(p.pool.QueryRow(ctx, ticketSelect+`WHERE t.id=$1`, id))
}
func (p *Postgres) GetCurrentTicket(ctx context.Context, windowID string) (*domain.Ticket, error) {
	id, err := uuid(windowID)
	if err != nil {
		return nil, err
	}
	// Keep window existence and the returned ticket in one consistent snapshot.
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, dbError(err)
	}
	defer tx.Rollback(context.Background())
	var exists bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM windows WHERE id=$1)`, id).Scan(&exists)
	if err != nil {
		return nil, dbError(err)
	}
	if !exists {
		return nil, application.ErrNotFound
	}
	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.window_id=$1 AND t.status IN ('CALLED','SERVING')`, id))
	if errors.Is(err, application.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func replay(t domain.Ticket, branchID, serviceID pgtype.UUID, idempotencyKey string) (application.CreateQRTicketResult, error) {
	b, _ := uuid(t.BranchID)
	s, _ := uuid(t.ServiceID)
	if b != branchID || s != serviceID || t.Source != domain.TicketSourceQR {
		return application.CreateQRTicketResult{}, application.ErrIdempotencyConflict
	}
	if idempotencyKey != "" {
		rawToken, _ := DeterministicManagementToken(idempotencyKey)
		t.ManagementToken = &rawToken
	}
	return application.CreateQRTicketResult{Ticket: t, Replayed: true}, nil
}
func (p *Postgres) CreateQRTicket(ctx context.Context, cmd application.CreateQRTicketCommand) (application.CreateQRTicketResult, error) {
	var empty application.CreateQRTicketResult
	b, err := uuid(cmd.BranchID)
	if err != nil {
		return empty, err
	}
	s, err := uuid(cmd.ServiceID)
	if err != nil {
		return empty, err
	}
	if strings.TrimSpace(cmd.IdempotencyKey) == "" {
		return empty, fmt.Errorf("idempotency key required: %w", application.ErrInvalidState)
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, cmd.IdempotencyKey); err != nil {
		return empty, dbError(err)
	}
	existing, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.idempotency_key=$1`, cmd.IdempotencyKey))
	if err == nil {
		return replay(existing, b, s, cmd.IdempotencyKey)
	}
	if !errors.Is(err, application.ErrNotFound) {
		return empty, err
	}
	var enabled bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM branch_services WHERE branch_id=$1 AND service_id=$2)`, b, s).Scan(&enabled)
	if err != nil {
		return empty, dbError(err)
	}
	if !enabled {
		return empty, application.ErrNotFound
	}
	var tid string
	now := time.Now().UTC()
	policy := p.getBranchPolicyTx(ctx, tx, b)
	dueAt, readyAt, sourceRank := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{
		Source:    domain.TicketSourceQR,
		ServiceID: cmd.ServiceID,
	}, now)

	rawToken, tokenHash := DeterministicManagementToken(cmd.IdempotencyKey)
	err = tx.QueryRow(ctx, `INSERT INTO tickets(branch_id,service_id,source,status,idempotency_key,created_at,queue_entered_at,checkin_at,ready_at,due_at,source_rank,policy_version,management_token_hash)
 VALUES($1,$2,'QR','WAITING',$3,$4,$4,$4,$5,$6,$7,$8,$9)
 ON CONFLICT(idempotency_key) DO NOTHING RETURNING id::text`, b, s, cmd.IdempotencyKey, now, readyAt, dueAt, sourceRank, policy.PolicyVersion, tokenHash).Scan(&tid)
	if errors.Is(err, pgx.ErrNoRows) {
		// READ COMMITTED gives this statement a fresh snapshot after the conflicting insert commits.
		existing, err = scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.idempotency_key=$1`, cmd.IdempotencyKey))
		if err != nil {
			return empty, err
		}
		return replay(existing, b, s, cmd.IdempotencyKey)
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
		Actor:  "kiosk_qr",
		Reason: "ticket created",
		DueAt:  t.DueAt,
		At:     &now,
	}); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}
	return application.CreateQRTicketResult{Ticket: t}, nil
}

func (p *Postgres) CallNext(ctx context.Context, windowID string) (domain.Ticket, error) {
	return p.CallNextAt(ctx, windowID, time.Now().UTC())
}

func (p *Postgres) CallNextAt(ctx context.Context, windowID string, decisionTime time.Time) (domain.Ticket, error) {
	var empty domain.Ticket
	id, err := uuid(windowID)
	if err != nil {
		return empty, err
	}
	reqID := domain.RequestIDFromContext(ctx)

	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(context.Background())

	// Idempotency check by request_id if provided
	if reqID != "" {
		var replayID string
		err = tx.QueryRow(ctx, `SELECT ticket_id::text FROM ticket_events WHERE request_id=$1 AND type='CALLED' ORDER BY id DESC LIMIT 1`, reqID).Scan(&replayID)
		if err == nil {
			t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1`, replayID))
			if err == nil {
				return t, nil
			}
		}
	}

	var branch string
	var status domain.WindowStatus
	err = tx.QueryRow(ctx, `SELECT branch_id::text,status FROM windows WHERE id=$1 FOR UPDATE`, id).Scan(&branch, &status)
	if err != nil {
		return empty, dbError(err)
	}
	if status != domain.WindowStatusOpen {
		return empty, application.ErrWindowClosed
	}

	var busyID *string
	err = tx.QueryRow(ctx, `SELECT id::text FROM tickets WHERE window_id=$1 AND status IN ('CALLED','SERVING') LIMIT 1`, id).Scan(&busyID)
	if err == nil && busyID != nil {
		// If same request_id as the call event that assigned this ticket, replay
		if reqID != "" {
			var match bool
			_ = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ticket_events WHERE ticket_id=$1::uuid AND request_id=$2 AND type='CALLED')`, *busyID, reqID).Scan(&match)
			if match {
				t, scanErr := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1`, *busyID))
				if scanErr == nil {
					return t, nil
				}
			}
		}
		return empty, application.ErrWindowBusy
	}

	legacyPolicy, pErr := scanPolicy(tx.QueryRow(ctx, policySelect+` WHERE branch_id=$1::uuid`, branch))
	if errors.Is(pErr, application.ErrNotFound) {
		return empty, errors.New("queue policy missing for branch")
	}
	if pErr != nil {
		return empty, dbError(pErr)
	}

	candidateRows, err := tx.Query(ctx, `
		SELECT `+ticketColumns+`
		FROM tickets t
		LEFT JOIN windows w ON w.id = t.window_id
		LEFT JOIN services s ON s.id = t.service_id
		WHERE t.branch_id = $1::uuid
		  AND (t.window_id IS NULL OR t.window_id = $2::uuid)
		  AND EXISTS (SELECT 1 FROM window_services ws WHERE ws.window_id = $2::uuid AND ws.service_id = t.service_id)
		  AND (t.status = 'WAITING' OR (t.source = 'APPOINTMENT' AND t.status = 'SCHEDULED'))
		  AND t.ready_at <= $3::timestamptz
		ORDER BY t.due_at ASC,
		         CASE
		           WHEN t.source = 'APPOINTMENT' AND t.arrived_at IS NULL AND t.scheduled_at < $3::timestamptz - INTERVAL '30 minutes'
		             THEN 2
		           ELSE t.source_rank
		         END ASC,
		         t.checkin_at ASC, t.id ASC
		LIMIT 1
		FOR NO KEY UPDATE OF t SKIP LOCKED
	`, branch, windowID, decisionTime)
	if err != nil {
		return empty, dbError(err)
	}

	var candidates []domain.Ticket
	for candidateRows.Next() {
		cand, scanErr := scanTicket(candidateRows)
		if scanErr != nil {
			candidateRows.Close()
			return empty, scanErr
		}
		candidates = append(candidates, cand)
	}
	candidateRows.Close()

	if len(candidates) == 0 {
		// Check if any tickets have ready_at <= decisionTime + 1s (could be locked by concurrent tx or just arrived)
		var anyReadyNow bool
		err = tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM tickets t
				WHERE t.branch_id = $1::uuid
				  AND (t.window_id IS NULL OR t.window_id = $2::uuid)
				  AND EXISTS (SELECT 1 FROM window_services ws WHERE ws.window_id = $2::uuid AND ws.service_id = t.service_id)
				  AND (t.status = 'WAITING' OR (t.source = 'APPOINTMENT' AND t.status = 'SCHEDULED'))
				  AND t.ready_at <= $3::timestamptz + interval '1 second'
			)
		`, branch, windowID, decisionTime).Scan(&anyReadyNow)
		if err != nil {
			return empty, dbError(err)
		}
		if anyReadyNow {
			// Ready tickets exist right now, but were skipped/locked by another concurrent worker
			return empty, application.ErrNoEligibleTickets
		}

		// No ready tickets. Check if any future tickets exist
		var futureExists bool
		err = tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM tickets t
				WHERE t.branch_id = $1::uuid
				  AND (t.window_id IS NULL OR t.window_id = $2::uuid)
				  AND EXISTS (SELECT 1 FROM window_services ws WHERE ws.window_id = $2::uuid AND ws.service_id = t.service_id)
				  AND (t.status = 'WAITING' OR (t.source = 'APPOINTMENT' AND t.status = 'SCHEDULED'))
				  AND t.ready_at > $3::timestamptz + interval '1 second'
			)
		`, branch, windowID, decisionTime).Scan(&futureExists)
		if err != nil {
			return empty, dbError(err)
		}
		if futureExists {
			return empty, application.ErrNotEligibleYet
		}

		return empty, application.ErrNoEligibleTickets
	}

	winner := candidates[0]
	from := winner.Status

	// Update winning ticket to CALLED
	_, err = tx.Exec(ctx, `
		UPDATE tickets
		SET status = 'CALLED', window_id = $1::uuid, called_at = $2::timestamptz
		WHERE id = $3::uuid
	`, windowID, decisionTime, winner.ID)
	if err != nil {
		return empty, dbError(err)
	}

	// Rescan winner to get updated window and called_at
	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1::uuid`, winner.ID))
	if err != nil {
		return empty, err
	}

	// Format top-candidate explanation for ticket_events audit log
	explanation := fmt.Sprintf("chosen due_at=%v source_rank=%d checkin_at=%v",
		winner.DueAt, winner.SourceRank, winner.CheckinAt)

	policyVersion := legacyPolicy.Version
	priority := calculateLegacyPriority(winner, decisionTime, legacyPolicy)

	extra := EventExtra{
		Actor:     "operator",
		Reason:    explanation,
		DueAt:     winner.DueAt,
		RequestID: reqID,
		At:        &decisionTime,
	}

	if err = insertEvent(ctx, tx, t, domain.TicketEventCalled, &from, &policyVersion, &priority, extra); err != nil {
		return empty, err
	}

	// Enqueue notification in outbox; failure must not abort successful CallNext
	_ = p.enqueueCallNotification(ctx, tx, t)

	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}

	// Promote/enqueue near-turn notification for newly eligible top waiting tickets (position <= 2)
	_ = p.enqueueNearTurnForTopCandidates(ctx, nil, branch, decisionTime)

	return t, nil
}

func (p *Postgres) CallSpecificTicket(ctx context.Context, windowID string, ticketIDOrNumber string) (domain.Ticket, error) {
	return p.CallSpecificTicketAt(ctx, windowID, ticketIDOrNumber, time.Now().UTC())
}

func (p *Postgres) CallSpecificTicketAt(ctx context.Context, windowID string, ticketIDOrNumber string, decisionTime time.Time) (domain.Ticket, error) {
	var empty domain.Ticket
	clean := strings.TrimSpace(ticketIDOrNumber)
	if clean == "" {
		return p.CallNextAt(ctx, windowID, decisionTime)
	}

	id, err := uuid(windowID)
	if err != nil {
		return empty, err
	}
	reqID := domain.RequestIDFromContext(ctx)

	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(context.Background())

	// Idempotency check by request_id if provided
	if reqID != "" {
		var replayID string
		err = tx.QueryRow(ctx, `SELECT ticket_id::text FROM ticket_events WHERE request_id=$1 AND type='CALLED' ORDER BY id DESC LIMIT 1`, reqID).Scan(&replayID)
		if err == nil {
			t, scanErr := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1`, replayID))
			if scanErr == nil {
				return t, nil
			}
		}
	}

	var branch string
	var status domain.WindowStatus
	err = tx.QueryRow(ctx, `SELECT branch_id::text,status FROM windows WHERE id=$1 FOR UPDATE`, id).Scan(&branch, &status)
	if err != nil {
		return empty, dbError(err)
	}
	if status != domain.WindowStatusOpen {
		return empty, application.ErrWindowClosed
	}

	var busyID *string
	err = tx.QueryRow(ctx, `SELECT id::text FROM tickets WHERE window_id=$1 AND status IN ('CALLED','SERVING') LIMIT 1`, id).Scan(&busyID)
	if err == nil && busyID != nil {
		if reqID != "" {
			var match bool
			_ = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM ticket_events WHERE ticket_id=$1::uuid AND request_id=$2 AND type='CALLED')`, *busyID, reqID).Scan(&match)
			if match {
				t, scanErr := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1`, *busyID))
				if scanErr == nil {
					return t, nil
				}
			}
		}
		return empty, application.ErrWindowBusy
	}

	legacyPolicy, pErr := scanPolicy(tx.QueryRow(ctx, policySelect+` WHERE branch_id=$1::uuid`, branch))
	if errors.Is(pErr, application.ErrNotFound) {
		return empty, errors.New("queue policy missing for branch")
	}
	if pErr != nil {
		return empty, dbError(pErr)
	}

	// Query target ticket by id or public_number
	row := tx.QueryRow(ctx, `
		SELECT `+ticketColumns+`
		FROM tickets t
		LEFT JOIN windows w ON w.id = t.window_id
		LEFT JOIN services s ON s.id = t.service_id
		WHERE t.branch_id = $1::uuid
		  AND (t.window_id IS NULL OR t.window_id = $2::uuid)
		  AND EXISTS (SELECT 1 FROM window_services ws WHERE ws.window_id = $2::uuid AND ws.service_id = t.service_id)
		  AND (t.status = 'WAITING' OR (t.source = 'APPOINTMENT' AND (t.status = 'SCHEDULED' OR t.status = 'WAITING')))
		  AND (
		    t.id::text = $3
		    OR UPPER(t.public_number) = UPPER($3)
		    OR UPPER(t.public_number) = UPPER('A-' || $3)
		    OR UPPER(t.public_number) = UPPER('Q-' || $3)
		    OR UPPER(t.public_number) = UPPER('L-' || $3)
		  )
		LIMIT 1
		FOR UPDATE OF t
	`, branch, windowID, clean)

	target, err := scanTicket(row)
	if errors.Is(err, application.ErrNotFound) {
		var exists bool
		_ = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM tickets WHERE branch_id=$1::uuid AND (id::text=$2 OR UPPER(public_number)=UPPER($2)))`, branch, clean).Scan(&exists)
		if !exists {
			return empty, application.ErrNotFound
		}
		return empty, application.ErrNoOpenCompatibleWindow
	}
	if err != nil {
		return empty, dbError(err)
	}

	from := target.Status

	_, err = tx.Exec(ctx, `
		UPDATE tickets
		SET status = 'CALLED',
		    window_id = $1::uuid,
		    called_at = $2::timestamptz
		WHERE id = $3::uuid
	`, windowID, decisionTime, target.ID)
	if err != nil {
		return empty, dbError(err)
	}

	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1::uuid`, target.ID))
	if err != nil {
		return empty, err
	}

	policyVersion := legacyPolicy.Version
	priority := calculateLegacyPriority(target, decisionTime, legacyPolicy)

	extra := EventExtra{
		Actor:     "operator",
		Reason:    fmt.Sprintf("operator manual call for ticket %s", target.PublicNumber),
		DueAt:     target.DueAt,
		RequestID: reqID,
		At:        &decisionTime,
	}

	if err = insertEvent(ctx, tx, t, domain.TicketEventCalled, &from, &policyVersion, &priority, extra); err != nil {
		return empty, err
	}

	// Enqueue notification in outbox; failure must not abort successful call
	_ = p.enqueueCallNotification(ctx, tx, t)

	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}

	// Promote/enqueue near-turn notification for newly eligible top waiting tickets (position <= 2)
	_ = p.enqueueNearTurnForTopCandidates(ctx, nil, t.BranchID, decisionTime)

	return t, nil
}
func (p *Postgres) StartService(ctx context.Context, ticketID string) (domain.Ticket, error) {
	return p.transition(ctx, ticketID, domain.TicketStatusCalled, domain.TicketStatusServing, "service_started_at")
}
func (p *Postgres) CompleteService(ctx context.Context, ticketID string) (domain.Ticket, error) {
	return p.transition(ctx, ticketID, domain.TicketStatusServing, domain.TicketStatusCompleted, "completed_at")
}
func (p *Postgres) transition(ctx context.Context, ticketID string, from, to domain.TicketStatus, column string) (domain.Ticket, error) {
	var empty domain.Ticket
	id, err := uuid(ticketID)
	if err != nil {
		return empty, err
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(context.Background())
	var status domain.TicketStatus
	err = tx.QueryRow(ctx, `SELECT status FROM tickets WHERE id=$1 FOR UPDATE`, id).Scan(&status)
	if err != nil {
		return empty, dbError(err)
	}
	if status != from {
		return empty, application.ErrInvalidState
	}
	// column is a private constant supplied only by StartService/CompleteService.
	_, err = tx.Exec(ctx, `UPDATE tickets SET status=$2,`+column+`=clock_timestamp() WHERE id=$1 AND status=$3`, id, to, from)
	if err != nil {
		return empty, dbError(err)
	}
	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1`, id))
	if err != nil {
		return empty, err
	}
	eventType := domain.TicketEventServiceStarted
	if to == domain.TicketStatusCompleted {
		eventType = domain.TicketEventCompleted
		if t.Window != nil {
			var winStatus domain.WindowStatus
			_ = tx.QueryRow(ctx, `SELECT status FROM windows WHERE id=$1::uuid`, t.Window.ID).Scan(&winStatus)
			if winStatus == domain.WindowStatusClosing {
				_, _ = tx.Exec(ctx, `UPDATE windows SET status='CLOSED' WHERE id=$1::uuid`, t.Window.ID)
			}
		}
	}
	if err = insertEvent(ctx, tx, t, eventType, &from, nil, nil); err != nil {
		return empty, err
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}
	if observer, ok := p.predictor.(application.ETAObservation); ok && t.ServiceStartedAt != nil && t.CompletedAt != nil {
		observer.ObserveCompleted(t.ID, t.CompletedAt.Sub(*t.ServiceStartedAt).Seconds())
	}
	return t, nil
}

func (p *Postgres) ChangeWindowStatus(ctx context.Context, windowID string, status domain.WindowStatus) (domain.Window, error) {
	id, err := uuid(windowID)
	if err != nil {
		return domain.Window{}, err
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return domain.Window{}, dbError(err)
	}
	defer tx.Rollback(context.Background())

	var branchID string
	err = tx.QueryRow(ctx, `SELECT branch_id::text FROM windows WHERE id=$1 FOR UPDATE`, id).Scan(&branchID)
	if err != nil {
		return domain.Window{}, dbError(err)
	}

	policy := p.GetPolicy()

	if status == domain.WindowStatusClosed {
		// Check for active ticket at this window
		var activeID *string
		var activeStatus *domain.TicketStatus
		err = tx.QueryRow(ctx, `SELECT id::text, status FROM tickets WHERE window_id=$1 AND status IN ('CALLED', 'SERVING') FOR UPDATE`, id).Scan(&activeID, &activeStatus)
		if err == nil && activeID != nil && activeStatus != nil {
			if policy.WindowClose.Policy == domain.WindowCloseReturnToQueue {
				// Return to WAITING queue with original due_at and clear window
				t, scanErr := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1::uuid`, *activeID))
				if scanErr == nil {
					fromStatus := *activeStatus
					if _, updateErr := tx.Exec(ctx, `UPDATE tickets SET status='WAITING', window_id=NULL WHERE id=$1::uuid`, *activeID); updateErr != nil {
						return domain.Window{}, dbError(updateErr)
					}
					t.Status = domain.TicketStatusWaiting
					t.Window = nil
					_ = insertEvent(ctx, tx, t, domain.TicketEventReturned, &fromStatus, nil, nil, EventExtra{
						Actor:  "window_close",
						Reason: "window closed with return_to_queue policy",
						DueAt:  t.DueAt,
					})
				}
			} else {
				// finish_current: if SERVING, window transitions to CLOSING until completed
				if *activeStatus == domain.TicketStatusServing {
					status = domain.WindowStatusClosing
				}
			}
		}
	}

	_, err = tx.Exec(ctx, `UPDATE windows SET status=$1 WHERE id=$2`, string(status), id)
	if err != nil {
		return domain.Window{}, dbError(err)
	}

	if err = tx.Commit(ctx); err != nil {
		return domain.Window{}, dbError(err)
	}

	windows, err := p.ListBranchWindows(ctx, branchID)
	if err != nil {
		return domain.Window{}, err
	}
	for _, w := range windows {
		if w.ID == windowID {
			return w, nil
		}
	}
	return domain.Window{}, application.ErrNotFound
}

// UpdateWindowServices replaces the capability set of a window.
//
// Capabilities are not a cosmetic detail: call-next eligibility is decided by a join
// over window_services, so a capability set that only lives in the browser makes the
// window "live its own life" — the API keeps serving by the stale set and the next
// overview poll reverts the operator's change. The set is therefore replaced
// atomically and the persisted window is returned to the caller.
func (p *Postgres) UpdateWindowServices(ctx context.Context, cmd application.UpdateWindowServicesCommand) (domain.Window, error) {
	var empty domain.Window
	windowID, err := uuid(cmd.WindowID)
	if err != nil {
		return empty, err
	}
	if len(cmd.ServiceIDs) == 0 {
		return empty, application.ErrInvalidState
	}
	serviceIDs := make([]pgtype.UUID, 0, len(cmd.ServiceIDs))
	seen := make(map[[16]byte]struct{}, len(cmd.ServiceIDs))
	for _, raw := range cmd.ServiceIDs {
		id, convErr := uuid(raw)
		if convErr != nil {
			return empty, convErr
		}
		key := [16]byte(id.Bytes)
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		serviceIDs = append(serviceIDs, id)
	}

	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(context.Background())

	// Lock the window row so two operator screens cannot interleave their updates.
	var branchID string
	if err = tx.QueryRow(ctx, `SELECT branch_id::text FROM windows WHERE id=$1 FOR UPDATE`, windowID).Scan(&branchID); err != nil {
		return empty, dbError(err)
	}
	branch, err := uuid(branchID)
	if err != nil {
		return empty, err
	}

	// A capability may only reference a service enabled for the branch.
	var enabled int
	if err = tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM branch_services WHERE branch_id=$1 AND service_id=ANY($2::uuid[])`,
		branch, serviceIDs).Scan(&enabled); err != nil {
		return empty, dbError(err)
	}
	if enabled != len(serviceIDs) {
		return empty, application.ErrNotFound
	}

	// Only the capabilities that actually disappear are dropped; retained rows are
	// never rewritten. Since 000012 tickets no longer reference window_services, a
	// capability can be dropped even when the window already served the service.
	if _, err = tx.Exec(ctx,
		`DELETE FROM window_services WHERE window_id=$1 AND service_id <> ALL($2::uuid[])`,
		windowID, serviceIDs); err != nil {
		return empty, windowServicesError(err)
	}
	if _, err = tx.Exec(ctx,
		`INSERT INTO window_services(window_id, branch_id, service_id)
		 SELECT $1, $2, sid FROM unnest($3::uuid[]) AS sid
		 ON CONFLICT (window_id, service_id) DO NOTHING`,
		windowID, branch, serviceIDs); err != nil {
		return empty, windowServicesError(err)
	}
	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}

	windows, err := p.ListBranchWindows(ctx, branchID)
	if err != nil {
		return empty, err
	}
	for _, w := range windows {
		if w.ID == cmd.WindowID {
			return w, nil
		}
	}
	return empty, application.ErrNotFound
}

// windowServicesError maps capability foreign-key violations to the boundary state
// error. Since 000012 tickets no longer reference window_services, capability
// removal cannot fail on ticket history; the mapping only remains as a defensive
// guard against concurrent reference removals — callers get 409 instead of a
// sanitized 500.
func windowServicesError(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		return application.ErrInvalidState
	}
	return dbError(err)
}

func (p *Postgres) ReturnTicket(ctx context.Context, ticketID string) (domain.Ticket, error) {
	id, err := uuid(ticketID)
	if err != nil {
		return domain.Ticket{}, err
	}
	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return domain.Ticket{}, dbError(err)
	}
	defer tx.Rollback(context.Background())
	before, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1 FOR UPDATE OF t`, id))
	if errors.Is(err, application.ErrNotFound) {
		return domain.Ticket{}, application.ErrInvalidState
	}
	if err != nil {
		return domain.Ticket{}, err
	}
	if before.Status != domain.TicketStatusCalled && before.Status != domain.TicketStatusServing {
		return domain.Ticket{}, application.ErrInvalidState
	}

	var tag pgconn.CommandTag
	if before.Source == domain.TicketSourceAppointment {
		now := time.Now().UTC()
		bId, _ := uuid(before.BranchID)
		policy := p.getBranchPolicyTx(ctx, tx, bId)
		dueAt, readyAt, sourceRank := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{
			Source:      before.Source,
			ScheduledAt: before.ScheduledAt,
			ServiceID:   before.ServiceID,
			IsRequeued:  true,
		}, now)

		tag, err = tx.Exec(ctx, `UPDATE tickets SET status='WAITING', window_id=NULL, checkin_at=$2, ready_at=$3, due_at=$4, source_rank=$5, requeued_at=$2 WHERE id=$1 AND status IN ('CALLED', 'SERVING')`,
			id, now, readyAt, dueAt, sourceRank)
	} else {
		tag, err = tx.Exec(ctx, `UPDATE tickets SET status='WAITING', window_id=NULL WHERE id=$1 AND status IN ('CALLED', 'SERVING')`, id)
	}
	if err != nil {
		return domain.Ticket{}, dbError(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.Ticket{}, application.ErrInvalidState
	}
	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1`, id))
	if err != nil {
		return domain.Ticket{}, err
	}
	if err = insertEvent(ctx, tx, t, domain.TicketEventReturned, &before.Status, nil, nil); err != nil {
		return domain.Ticket{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.Ticket{}, dbError(err)
	}
	return t, nil
}

func (p *Postgres) RedirectTicket(ctx context.Context, cmd application.RedirectTicketCommand) (domain.Ticket, error) {
	id, err := uuid(cmd.TicketID)
	if err != nil {
		return domain.Ticket{}, err
	}

	var nw *pgtype.UUID
	if cmd.NewWindowID != "" {
		parsed, err := uuid(cmd.NewWindowID)
		if err != nil {
			return domain.Ticket{}, err
		}
		nw = &parsed
	}

	tx, err := p.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return domain.Ticket{}, dbError(err)
	}
	defer tx.Rollback(context.Background())
	before, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1 FOR UPDATE OF t`, id))
	if errors.Is(err, application.ErrNotFound) {
		return domain.Ticket{}, application.ErrInvalidState
	}
	if err != nil {
		return domain.Ticket{}, err
	}
	if before.Status != domain.TicketStatusCalled && before.Status != domain.TicketStatusServing {
		return domain.Ticket{}, application.ErrInvalidState
	}

	var ns pgtype.UUID
	targetServiceID := before.ServiceID
	if cmd.NewServiceID != "" {
		ns, err = uuid(cmd.NewServiceID)
		if err != nil {
			return domain.Ticket{}, err
		}
		targetServiceID = cmd.NewServiceID
	} else {
		ns, err = uuid(before.ServiceID)
		if err != nil {
			return domain.Ticket{}, err
		}
	}

	var tag pgconn.CommandTag
	if before.Source == domain.TicketSourceAppointment {
		now := time.Now().UTC()
		bId, _ := uuid(before.BranchID)
		policy := p.getBranchPolicyTx(ctx, tx, bId)
		dueAt, readyAt, sourceRank := domain.ComputeSchedule(policy, domain.ScheduleTicketInput{
			Source:      before.Source,
			ScheduledAt: before.ScheduledAt,
			ServiceID:   targetServiceID,
			IsRequeued:  true,
		}, now)

		if nw != nil {
			tag, err = tx.Exec(ctx, `UPDATE tickets SET status='WAITING', window_id=$1, service_id=$2, checkin_at=$3, ready_at=$4, due_at=$5, source_rank=$6, requeued_at=$3 WHERE id=$7 AND status IN ('CALLED', 'SERVING')`,
				nw, ns, now, readyAt, dueAt, sourceRank, id)
		} else {
			tag, err = tx.Exec(ctx, `UPDATE tickets SET status='WAITING', window_id=NULL, service_id=$1, checkin_at=$2, ready_at=$3, due_at=$4, source_rank=$5, requeued_at=$2 WHERE id=$6 AND status IN ('CALLED', 'SERVING')`,
				ns, now, readyAt, dueAt, sourceRank, id)
		}
	} else {
		if nw != nil {
			tag, err = tx.Exec(ctx, `UPDATE tickets SET status='WAITING', window_id=$1, service_id=$2 WHERE id=$3 AND status IN ('CALLED', 'SERVING')`, nw, ns, id)
		} else {
			tag, err = tx.Exec(ctx, `UPDATE tickets SET status='WAITING', window_id=NULL, service_id=$1 WHERE id=$2 AND status IN ('CALLED', 'SERVING')`, ns, id)
		}
	}
	if err != nil {
		return domain.Ticket{}, dbError(err)
	}
	if tag.RowsAffected() == 0 {
		return domain.Ticket{}, application.ErrInvalidState
	}
	t, err := scanTicket(tx.QueryRow(ctx, ticketSelect+`WHERE t.id=$1`, id))
	if err != nil {
		return domain.Ticket{}, err
	}
	if err = insertEvent(ctx, tx, t, domain.TicketEventRedirected, &before.Status, nil, nil); err != nil {
		return domain.Ticket{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return domain.Ticket{}, dbError(err)
	}
	return t, nil
}

func calculateLegacyPriority(t domain.Ticket, decisionTime time.Time, p domain.QueuePolicy) int64 {
	basePriority := int64(p.LivePriority)
	if t.Source == domain.TicketSourceAppointment {
		basePriority = int64(p.AppointmentDuePriority)
	} else if t.Source == domain.TicketSourceQR {
		basePriority = int64(p.QRPriority)
	}

	effectiveQueueTime := t.QueueEnteredAt
	if t.Source == domain.TicketSourceAppointment && t.ScheduledAt != nil {
		effectiveQueueTime = *t.ScheduledAt
		if t.ArrivedAt != nil && t.ArrivedAt.After(*t.ScheduledAt) {
			effectiveQueueTime = *t.ArrivedAt
		}
	}

	latenessPenalty := int64(0)
	if t.Source == domain.TicketSourceAppointment && t.ScheduledAt != nil {
		arrived := *t.ScheduledAt
		if t.ArrivedAt != nil {
			arrived = *t.ArrivedAt
		}
		rawLatenessSeconds := int64(arrived.Sub(*t.ScheduledAt).Seconds())
		if rawLatenessSeconds > 0 {
			penaltySeconds := rawLatenessSeconds - int64(p.AppointmentGraceMinutes)*60
			if penaltySeconds > 0 {
				pen := penaltySeconds * int64(p.AppointmentLatePenaltyPerMinute) / 60
				if pen > int64(p.AppointmentLatePenaltyMaxPoints) {
					pen = int64(p.AppointmentLatePenaltyMaxPoints)
				}
				latenessPenalty = pen
			}
		}
	}

	waitingSeconds := int64(decisionTime.Sub(effectiveQueueTime).Seconds())
	if waitingSeconds < 0 {
		waitingSeconds = 0
	}
	boost := int64(0)
	starveThreshold := int64(p.AntiStarvationThresholdMinutes) * 60
	if waitingSeconds > starveThreshold {
		boost = (waitingSeconds - starveThreshold) * int64(p.AntiStarvationPointsPerMinute) / 60
	}

	effBase := basePriority - latenessPenalty
	if effBase < 0 {
		effBase = 0
	}
	return effBase + boost
}

func (p *Postgres) FindActiveTicketByClient(ctx context.Context, clientID string) (*domain.Ticket, error) {
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return nil, nil
	}
	query := ticketSelect + `WHERE t.client_id = $1 AND t.status IN ('SCHEDULED', 'WAITING', 'CALLED', 'SERVING') ORDER BY t.created_at DESC LIMIT 1`
	t, err := scanTicket(p.pool.QueryRow(ctx, query, clientID))
	if errors.Is(err, application.ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, dbError(err)
	}
	return &t, nil
}

func (p *Postgres) ListActiveTicketsByClient(ctx context.Context, clientID string) ([]domain.Ticket, error) {
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return []domain.Ticket{}, nil
	}

	query := ticketSelect + `
		WHERE (
			t.client_id = $1 
			OR t.client_id IN (
				SELECT ea.user_id::text FROM external_accounts ea
				WHERE ea.external_user_id IN (
					SELECT ea2.external_user_id FROM external_accounts ea2 WHERE ea2.user_id::text = $1
				)
			)
			OR t.client_id IN (
				SELECT ea.external_user_id FROM external_accounts ea WHERE ea.user_id::text = $1
			)
			OR (
				EXISTS (
					SELECT 1 FROM users u 
					WHERE u.id::text = $1 AND (u.email LIKE '%@yandex.ru' OR u.password_hash = 'OAUTH_ACCOUNT')
				)
				AND (
					t.client_id IN (
						SELECT ea3.user_id::text FROM external_accounts ea3 WHERE ea3.provider = 'yandex_alice'
					)
					OR t.client_id IN (
						SELECT u2.id::text FROM users u2 WHERE u2.email LIKE 'yandex_alice_%'
					)
				)
			)
		)
		AND t.status IN ('SCHEDULED', 'WAITING', 'CALLED', 'SERVING')
		ORDER BY t.created_at DESC
	`
	rows, err := p.pool.Query(ctx, query, clientID)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()

	var list []domain.Ticket
	for rows.Next() {
		t, err := scanTicket(rows)
		if err != nil {
			return nil, dbError(err)
		}
		list = append(list, t)
	}
	if list == nil {
		list = []domain.Ticket{}
	}
	return list, dbError(rows.Err())
}



package persistence

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func (p *Postgres) SubmitFeedback(ctx context.Context, ticketID string, rating int, comment string) error {
	if rating < 1 || rating > 5 {
		return application.ErrInvalidState
	}
	ticket, err := uuid(ticketID)
	if err != nil {
		return err
	}
	token, ok := ManagementTokenFromContext(ctx)
	if !ok || token == "" {
		return application.ErrForbidden
	}
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return dbError(err)
	}
	defer tx.Rollback(context.Background())
	var status string
	var expected *string
	err = tx.QueryRow(ctx, `SELECT status, management_token_hash FROM tickets WHERE id=$1 FOR UPDATE`, ticket).Scan(&status, &expected)
	if errors.Is(err, pgx.ErrNoRows) {
		return application.ErrNotFound
	}
	if err != nil {
		return dbError(err)
	}
	if expected == nil || *expected == "" || HashManagementToken(token) != *expected {
		return application.ErrForbidden
	}
	if status != "COMPLETED" {
		return application.ErrInvalidState
	}
	_, err = tx.Exec(ctx, `INSERT INTO ticket_feedback(ticket_id,rating,comment) VALUES($1,$2,$3)`, ticket, rating, comment)
	if err != nil {
		if pgErr, ok := err.(interface{ SQLState() string }); ok && pgErr.SQLState() == "23505" {
			return application.ErrIdempotencyConflict
		}
		return dbError(err)
	}
	return dbError(tx.Commit(ctx))
}

func (p *Postgres) ListBranchReviews(ctx context.Context, branchID string) ([]domain.RecentFeedback, error) {
	bid, err := uuid(branchID)
	if err != nil {
		return nil, err
	}
	rows, err := p.pool.Query(ctx, `
		SELECT f.rating, f.comment, f.created_at
		FROM tickets t
		JOIN ticket_feedback f ON f.ticket_id = t.id
		WHERE t.branch_id = $1 AND t.status = 'COMPLETED' AND f.comment <> ''
		ORDER BY f.created_at DESC
		LIMIT 20
	`, bid)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()

	out := make([]domain.RecentFeedback, 0)
	for rows.Next() {
		var f domain.RecentFeedback
		if err := rows.Scan(&f.Rating, &f.Comment, &f.CreatedAt); err != nil {
			return nil, dbError(err)
		}
		out = append(out, f)
	}
	return out, dbError(rows.Err())
}

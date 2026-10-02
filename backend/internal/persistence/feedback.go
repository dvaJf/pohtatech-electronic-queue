package persistence

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"postcode/backend/internal/application"
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

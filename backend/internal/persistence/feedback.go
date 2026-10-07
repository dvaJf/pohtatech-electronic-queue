package persistence

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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
	token, hasToken := ManagementTokenFromContext(ctx)
	ownerID, hasOwner := ClientOwnerFromContext(ctx)
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return dbError(err)
	}
	defer tx.Rollback(context.Background())
	var status string
	var expected *string
	var branchID pgtype.UUID
	var clientID *string
	err = tx.QueryRow(ctx, `SELECT status, management_token_hash, branch_id, client_id FROM tickets WHERE id=$1 FOR UPDATE`, ticket).Scan(&status, &expected, &branchID, &clientID)
	if errors.Is(err, pgx.ErrNoRows) {
		return application.ErrNotFound
	}
	if err != nil {
		return dbError(err)
	}
	if status != "COMPLETED" {
		return application.ErrInvalidState
	}

	isOwner := hasOwner && clientID != nil && *clientID == ownerID
	if !isOwner {
		if hasToken && token != "" {
			if expected == nil || *expected == "" || HashManagementToken(token) != *expected {
				return application.ErrForbidden
			}
		} else if expected != nil && *expected != "" {
			return application.ErrForbidden
		}
	}

	cleanComment := strings.TrimSpace(comment)
	if len([]rune(cleanComment)) > 2000 {
		return application.ErrInvalidState
	}

	// A completed visit accepts exactly one immutable review. Branch-only reviews
	// keep ticket_id NULL and are not constrained by the partial unique index.
	tag, err := tx.Exec(ctx, `
		INSERT INTO ticket_feedback(ticket_id, branch_id, rating, comment)
		VALUES($1, $2, $3, $4)
		ON CONFLICT (ticket_id) WHERE ticket_id IS NOT NULL DO NOTHING
	`, ticket, branchID, rating, cleanComment)
	if err != nil {
		if pgErr, ok := err.(interface{ SQLState() string }); ok && pgErr.SQLState() == "23505" {
			return application.ErrIdempotencyConflict
		}
		return dbError(err)
	}
	if tag.RowsAffected() == 0 {
		return application.ErrIdempotencyConflict
	}
	return dbError(tx.Commit(ctx))
}

func (p *Postgres) SubmitBranchReview(ctx context.Context, branchID string, rating int, comment string) (domain.CreatedReview, error) {
	if rating < 1 || rating > 5 {
		return domain.CreatedReview{}, application.ErrInvalidState
	}
	bid, err := uuid(branchID)
	if err != nil {
		return domain.CreatedReview{}, err
	}
	var exists bool
	err = p.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM branches WHERE id=$1)`, bid).Scan(&exists)
	if err != nil {
		return domain.CreatedReview{}, dbError(err)
	}
	if !exists {
		return domain.CreatedReview{}, application.ErrNotFound
	}

	cleanComment := strings.TrimSpace(comment)
	if len([]rune(cleanComment)) > 2000 {
		return domain.CreatedReview{}, application.ErrInvalidState
	}

	var res domain.CreatedReview
	var id pgtype.UUID
	err = p.pool.QueryRow(ctx, `
		INSERT INTO ticket_feedback(branch_id, rating, comment)
		VALUES($1, $2, $3)
		RETURNING id, branch_id::text, rating, comment, created_at
	`, bid, rating, cleanComment).Scan(&id, &res.BranchID, &res.Rating, &res.Comment, &res.CreatedAt)
	if err != nil {
		return domain.CreatedReview{}, dbError(err)
	}
	res.ID = fmt.Sprintf("%x-%x-%x-%x-%x", id.Bytes[0:4], id.Bytes[4:6], id.Bytes[6:8], id.Bytes[8:10], id.Bytes[10:16])
	return res, nil
}

func (p *Postgres) ListBranchReviews(ctx context.Context, branchID string) ([]domain.RecentFeedback, error) {
	bid, err := uuid(branchID)
	if err != nil {
		return nil, err
	}
	rows, err := p.pool.Query(ctx, `
		SELECT f.rating, f.comment, f.created_at
		FROM ticket_feedback f
		LEFT JOIN tickets t ON t.id = f.ticket_id
		WHERE (f.branch_id = $1 OR (f.branch_id IS NULL AND t.branch_id = $1))
		  AND f.comment <> ''
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

func (p *Postgres) GetAdminReviews(ctx context.Context, filter domain.AdminReviewsFilter) (domain.AdminReviewsResult, error) {
	var branchUUID *pgtype.UUID
	if filter.BranchID != "" && filter.BranchID != "all" {
		u, err := uuid(filter.BranchID)
		if err == nil {
			branchUUID = &u
		}
	}

	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	offset := (page - 1) * pageSize

	// 1. Overall stats for this branch/filter
	var avgRating *float64
	var totalReviews int
	err := p.pool.QueryRow(ctx, `
		SELECT AVG(f.rating)::double precision, COUNT(*)
		FROM ticket_feedback f
		LEFT JOIN tickets t ON t.id = f.ticket_id
		WHERE ($1::uuid IS NULL OR COALESCE(f.branch_id, t.branch_id) = $1::uuid)
	`, branchUUID).Scan(&avgRating, &totalReviews)
	if err != nil {
		return domain.AdminReviewsResult{}, dbError(err)
	}

	if avgRating != nil {
		rounded := math.Round(*avgRating*10) / 10
		avgRating = &rounded
	}

	// 2. Star distribution (5 -> 1)
	distMap := map[string]int{"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}
	distRows, err := p.pool.Query(ctx, `
		SELECT f.rating, COUNT(*)
		FROM ticket_feedback f
		LEFT JOIN tickets t ON t.id = f.ticket_id
		WHERE ($1::uuid IS NULL OR COALESCE(f.branch_id, t.branch_id) = $1::uuid)
		GROUP BY f.rating
	`, branchUUID)
	if err != nil {
		return domain.AdminReviewsResult{}, dbError(err)
	}
	for distRows.Next() {
		var star int
		var count int
		if err := distRows.Scan(&star, &count); err == nil {
			distMap[fmt.Sprintf("%d", star)] = count
		}
	}
	distRows.Close()

	// 3. Total filtered count
	var filteredTotal int
	err = p.pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM ticket_feedback f
		LEFT JOIN tickets t ON t.id = f.ticket_id
		WHERE ($1::uuid IS NULL OR COALESCE(f.branch_id, t.branch_id) = $1::uuid)
		  AND ($2::int <= 0 OR f.rating = $2::int)
	`, branchUUID, filter.Rating).Scan(&filteredTotal)
	if err != nil {
		return domain.AdminReviewsResult{}, dbError(err)
	}

	totalPages := 1
	if filteredTotal > 0 {
		totalPages = int(math.Ceil(float64(filteredTotal) / float64(pageSize)))
	}

	// 4. Paginated items
	orderClause := "ORDER BY f.created_at DESC"
	if strings.ToLower(filter.Sort) == "oldest" {
		orderClause = "ORDER BY f.created_at ASC"
	}

	query := fmt.Sprintf(`
		SELECT f.id::text,
		       COALESCE(f.branch_id::text, t.branch_id::text, '') AS branch_id,
		       COALESCE(b.name, 'Отделение Почты') AS branch_name,
		       f.rating,
		       f.comment,
		       f.created_at
		FROM ticket_feedback f
		LEFT JOIN tickets t ON t.id = f.ticket_id
		LEFT JOIN branches b ON b.id = COALESCE(f.branch_id, t.branch_id)
		WHERE ($1::uuid IS NULL OR COALESCE(f.branch_id, t.branch_id) = $1::uuid)
		  AND ($2::int <= 0 OR f.rating = $2::int)
		%s
		LIMIT $3 OFFSET $4
	`, orderClause)

	rows, err := p.pool.Query(ctx, query, branchUUID, filter.Rating, pageSize, offset)
	if err != nil {
		return domain.AdminReviewsResult{}, dbError(err)
	}
	defer rows.Close()

	items := make([]domain.AdminReviewItem, 0)
	for rows.Next() {
		var item domain.AdminReviewItem
		if err := rows.Scan(&item.ID, &item.BranchID, &item.BranchName, &item.Rating, &item.Comment, &item.CreatedAt); err != nil {
			return domain.AdminReviewsResult{}, dbError(err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return domain.AdminReviewsResult{}, dbError(err)
	}

	return domain.AdminReviewsResult{
		Items:      items,
		Page:       page,
		PageSize:   pageSize,
		Total:      filteredTotal,
		TotalPages: totalPages,
		Summary: domain.AdminReviewSummary{
			AverageRating: avgRating,
			TotalReviews:  totalReviews,
			Distribution:  distMap,
		},
	}, nil
}

package persistence

import (
	"context"
	"errors"
	"testing"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func completedFor(t *testing.T, ctx context.Context, p *Postgres, branch, window, key string) (string, string) {
	t.Helper()
	r, err := p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: branch, ServiceID: parcels, IdempotencyKey: key})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = p.CallNext(ctx, window); err != nil {
		t.Fatal(err)
	}
	if _, err = p.StartService(ctx, r.Ticket.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = p.CompleteService(ctx, r.Ticket.ID); err != nil {
		t.Fatal(err)
	}
	return r.Ticket.ID, *r.Ticket.ManagementToken
}

func TestFeedbackBranchIsolationAndEligibility(t *testing.T) {
	ctx, p, _ := integration(t)
	branchB, windowB := "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	execSQL(t, ctx, p, `INSERT INTO branches(id,name,address) VALUES($1::uuid,'B','B')`, branchB)
	execSQL(t, ctx, p, `INSERT INTO branch_services(branch_id,service_id) VALUES($1::uuid,$2::uuid)`, branchB, parcels)
	execSQL(t, ctx, p, `INSERT INTO queue_policies(branch_id,appointment_due_priority,qr_priority,live_priority,anti_starvation_threshold_minutes,anti_starvation_points_per_minute,appointment_grace_minutes,appointment_late_penalty_per_minute,appointment_late_penalty_max_points,version) SELECT $1::uuid,appointment_due_priority,qr_priority,live_priority,anti_starvation_threshold_minutes,anti_starvation_points_per_minute,appointment_grace_minutes,appointment_late_penalty_per_minute,appointment_late_penalty_max_points,version FROM queue_policies WHERE branch_id=$2::uuid`, branchB, demoBranch)
	execSQL(t, ctx, p, `INSERT INTO windows(id,branch_id,number,status) VALUES($1::uuid,$2::uuid,1,'OPEN')`, windowB, branchB)
	execSQL(t, ctx, p, `INSERT INTO window_services(window_id,branch_id,service_id) VALUES($1::uuid,$2::uuid,$3::uuid)`, windowB, branchB, parcels)
	for i, r := range []int{5, 4} {
		id, token := completedFor(t, ctx, p, demoBranch, window1, "a"+string(rune('a'+i)))
		if err := p.SubmitFeedback(WithManagementToken(ctx, token), id, r, ""); err != nil {
			t.Fatal(err)
		}
	}
	for i, r := range []int{1, 2, 3} {
		id, token := completedFor(t, ctx, p, branchB, windowB, "b"+string(rune('a'+i)))
		if err := p.SubmitFeedback(WithManagementToken(ctx, token), id, r, ""); err != nil {
			t.Fatal(err)
		}
	}
	a, err := p.GetAdminOverview(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	b, err := p.GetAdminOverview(ctx, branchB)
	if err != nil {
		t.Fatal(err)
	}
	if a.Quality.RatingCount != 2 || a.Quality.RatingAverage == nil || *a.Quality.RatingAverage != 4.5 || b.Quality.RatingCount != 3 || b.Quality.RatingAverage == nil || *b.Quality.RatingAverage != 2 {
		t.Fatalf("a=%+v b=%+v", a.Quality, b.Quality)
	}
	branches, err := p.ListBranches(ctx)
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]domain.Branch{}
	for _, x := range branches {
		got[x.ID] = x
	}
	if got[demoBranch].RatingCount != 2 || got[branchB].RatingCount != 3 {
		t.Fatal(got)
	}
	// Cancelled and WAITING are real non-completed states and cannot create rows.
	w := create(t, ctx, p, parcels, "cancelled")
	if _, err := p.CancelTicket(WithManagementToken(ctx, *w.ManagementToken), w.ID); err != nil {
		t.Fatal(err)
	}
	for _, ticket := range []domain.Ticket{w, create(t, ctx, p, parcels, "waiting")} {
		wantError(t, p.SubmitFeedback(WithManagementToken(ctx, *ticket.ManagementToken), ticket.ID, 5, ""), application.ErrInvalidState)
		var n int
		if err := p.pool.QueryRow(ctx, `SELECT count(*) FROM ticket_feedback WHERE ticket_id=$1::uuid`, ticket.ID).Scan(&n); err != nil || n != 0 {
			t.Fatalf("feedback rows=%d err=%v", n, err)
		}
	}
}

func TestFeedbackAnalyticsEmptyPeriods(t *testing.T) {
	ctx, p, _ := integration(t)
	ids := feedbacks(t, ctx, p, []int{5, 4}, "current-")
	for _, id := range ids {
		execSQL(t, ctx, p, `UPDATE ticket_feedback SET created_at=CURRENT_TIMESTAMP-INTERVAL '1 day' WHERE ticket_id=$1::uuid`, id)
	}
	o, _ := p.GetAdminOverview(ctx, demoBranch)
	if o.Quality.Current30Count != 2 || o.Quality.Previous30Average != nil || o.Quality.Delta != nil {
		t.Fatal(o.Quality)
	}
	ctx, p, _ = integration(t)
	ids = feedbacks(t, ctx, p, []int{4, 3}, "previous-")
	for _, id := range ids {
		execSQL(t, ctx, p, `UPDATE ticket_feedback SET created_at=CURRENT_TIMESTAMP-INTERVAL '31 days' WHERE ticket_id=$1::uuid`, id)
	}
	o, _ = p.GetAdminOverview(ctx, demoBranch)
	if o.Quality.Current30Average != nil || o.Quality.Delta != nil {
		t.Fatal(o.Quality)
	}
	ctx, p, _ = integration(t)
	o, _ = p.GetAdminOverview(ctx, demoBranch)
	if o.Quality.Current30Average != nil || o.Quality.Previous30Average != nil || o.Quality.Delta != nil {
		t.Fatal(o.Quality)
	}
}

func TestFeedbackNoShowIsIneligible(t *testing.T) {
	ctx, p, _ := integration(t)
	ticket := create(t, ctx, p, parcels, "feedback-no-show")
	if _, err := p.CallNext(ctx, window1); err != nil {
		t.Fatal(err)
	}
	if _, err := p.MarkNoShow(ctx, ticket.ID); err != nil {
		t.Fatal(err)
	}
	wantError(t, p.SubmitFeedback(WithManagementToken(ctx, *ticket.ManagementToken), ticket.ID, 5, ""), application.ErrInvalidState)
	var n int
	if err := p.pool.QueryRow(ctx, `SELECT count(*) FROM ticket_feedback WHERE ticket_id=$1::uuid`, ticket.ID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("rows=%d err=%v", n, err)
	}
}

func feedbacks(t *testing.T, ctx context.Context, p *Postgres, values []int, key string) []string {
	t.Helper()
	ids := make([]string, 0, len(values))
	for i, value := range values {
		id, token := completedFeedbackTicket(t, ctx, p, key+string(rune('a'+i)))
		if err := p.SubmitFeedback(WithManagementToken(ctx, token), id, value, ""); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	return ids
}

func TestFeedbackAnalyticsDistributionAndPeriods(t *testing.T) {
	ctx, p, _ := integration(t)
	feedbacks(t, ctx, p, []int{5, 5, 4, 3, 2, 1}, "dist-")
	o, err := p.GetAdminOverview(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	q := o.Quality
	if q.RatingCount != 6 || q.RatingAverage == nil || *q.RatingAverage != 20.0/6.0 || q.LowRatingCount != 2 || q.Distribution["5"] != 2 || q.Distribution["4"] != 1 || q.Distribution["3"] != 1 || q.Distribution["2"] != 1 || q.Distribution["1"] != 1 {
		t.Fatalf("quality=%+v", q)
	}
	if q.Distribution["1"]+q.Distribution["2"]+q.Distribution["3"]+q.Distribution["4"]+q.Distribution["5"] != q.RatingCount {
		t.Fatal("distribution sum")
	}
}

func TestFeedbackAnalyticsThirtyDayWindows(t *testing.T) {
	ctx, p, _ := integration(t)
	ids := feedbacks(t, ctx, p, []int{5, 5, 4, 3, 4, 1}, "period-")
	// SQL uses [now-30d, now) for current and [now-60d, now-30d) for previous.
	for i, age := range []string{"1 day", "2 days", "3 days", "31 days", "32 days", "61 days"} {
		execSQL(t, ctx, p, `UPDATE ticket_feedback SET created_at=CURRENT_TIMESTAMP-$1::interval WHERE ticket_id=$2::uuid`, age, ids[i])
	}
	o, err := p.GetAdminOverview(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	q := o.Quality
	if q.Current30Count != 3 || q.Previous30Count != 2 || q.Current30Average == nil || q.Previous30Average == nil || q.Delta == nil || *q.Current30Average != 14.0/3.0 || *q.Previous30Average != 3.5 {
		t.Fatalf("period quality=%+v", q)
	}
}

func TestFeedbackMigrationRoundTrip(t *testing.T) {
	ctx, p, m := integration(t)
	if err := m.Steps(-1); err != nil {
		t.Fatal(err)
	}
	var exists *string
	if err := p.pool.QueryRow(ctx, `SELECT to_regclass('ticket_feedback')::text`).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists != nil {
		t.Fatalf("feedback table remains after rollback: %s", *exists)
	}
	if err := m.Up(); err != nil {
		t.Fatal(err)
	}
	if err := p.pool.QueryRow(ctx, `SELECT to_regclass('ticket_feedback')::text`).Scan(&exists); err != nil || exists == nil {
		t.Fatalf("feedback table after re-apply=%v err=%v", exists, err)
	}
}

func completedFeedbackTicket(t *testing.T, ctx context.Context, p *Postgres, key string) (string, string) {
	t.Helper()
	ticket := create(t, ctx, p, parcels, key)
	called, err := p.CallNext(ctx, window1)
	if err != nil || called.ID != ticket.ID {
		t.Fatalf("call: %+v %v", called, err)
	}
	if _, err = p.StartService(ctx, ticket.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = p.CompleteService(ctx, ticket.ID); err != nil {
		t.Fatal(err)
	}
	return ticket.ID, *ticket.ManagementToken
}

func TestFeedbackCompletedTicketIntegrity(t *testing.T) {
	ctx, p, _ := integration(t)
	ticketID, token := completedFeedbackTicket(t, ctx, p, "feedback-valid")
	if err := p.SubmitFeedback(WithManagementToken(ctx, token), ticketID, 5, "быстро"); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := p.pool.QueryRow(ctx, `SELECT count(*) FROM ticket_feedback WHERE ticket_id=$1::uuid`, ticketID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("count=%d err=%v", count, err)
	}
	wantError(t, p.SubmitFeedback(WithManagementToken(ctx, token), ticketID, 4, "duplicate"), application.ErrIdempotencyConflict)
	for _, rating := range []int{0, 6} {
		wantError(t, p.SubmitFeedback(WithManagementToken(ctx, token), ticketID, rating, ""), application.ErrInvalidState)
	}
	wantError(t, p.SubmitFeedback(WithManagementToken(ctx, "wrong"), ticketID, 5, ""), application.ErrForbidden)

	var successes int
	errs := make([]error, 2)
	secondID, secondToken := completedFeedbackTicket(t, ctx, p, "feedback-concurrent")
	concurrently(2, func(i int) {
		errs[i] = p.SubmitFeedback(WithManagementToken(context.Background(), secondToken), secondID, 5, "")
	})
	for _, err := range errs {
		if err == nil {
			successes++
		} else if !errors.Is(err, application.ErrIdempotencyConflict) {
			t.Fatalf("concurrent err=%v", err)
		}
	}
	if successes != 1 {
		t.Fatalf("successes=%d", successes)
	}
	waiting := create(t, ctx, p, parcels, "feedback-waiting")
	wantError(t, p.SubmitFeedback(WithManagementToken(ctx, *waiting.ManagementToken), waiting.ID, 5, ""), application.ErrInvalidState)
}

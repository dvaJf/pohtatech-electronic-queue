package persistence

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

const (
	demoBranch = "11111111-1111-1111-1111-111111111111"
	parcels    = "22222222-2222-2222-2222-222222222222"
	payments   = "55555555-5555-5555-5555-555555555555"
	window1    = "33333333-3333-3333-3333-333333333333"
	window2    = "44444444-4444-4444-4444-444444444444"
	window3    = "66666666-6666-6666-6666-666666666666"
	missing    = "00000000-0000-0000-0000-000000000000"

	// migrationHead is the last migration in ../../migrations. Bump it together with
	// every new migration, otherwise the whole integration suite fails on the version
	// guard instead of the behaviour it is meant to protect.
	migrationHead = 36

	// Absolute versions replayed by the migration tests. They must not be expressed as
	// a step count from the head: adding 000007+ silently shifted every relative
	// rollback onto the wrong migration.
	migrationInitial    = 1 // 000001_initial only
	migrationPreSprint2 = 4 // head before 000005 appointment normalization and events
	migrationPreSprint3 = 5 // head before 000006 sprint #3 queue engine
)

// downTo rolls the schema back to an absolute migration version.
func downTo(t *testing.T, m *migrate.Migrate, version uint) {
	t.Helper()
	steps := int(migrationHead) - int(version)
	if steps <= 0 {
		t.Fatalf("downTo(%d) from head %d is not a rollback", version, migrationHead)
	}
	if err := m.Steps(-steps); err != nil {
		t.Fatal(err)
	}
}

// Every test gets a private schema. Existing application data is never reset.
func integration(t *testing.T) (context.Context, *Postgres, *migrate.Migrate) {
	t.Helper()
	dsn := os.Getenv("CORE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set CORE_TEST_DATABASE_URL to run PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(admin.Close)
	var nonce [12]byte
	rand.Read(nonce[:])
	schema := "core_test_" + hex.EncodeToString(nonce[:])
	if _, err = admin.Exec(ctx, `CREATE SCHEMA `+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		if _, err := admin.Exec(cleanup, `DROP SCHEMA `+pgx.Identifier{schema}.Sanitize()+` CASCADE`); err != nil {
			t.Error(err)
		}
	})
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	m, err := migrate.New("file://../../migrations", u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		a, b := m.Close()
		if a != nil || b != nil {
			t.Errorf("migration close: %v %v", a, b)
		}
	})
	if err = m.Up(); err != nil {
		t.Fatal(err)
	}
	version, dirty, err := m.Version()
	if err != nil || version != migrationHead || dirty {
		t.Fatalf("migration version=%d dirty=%v err=%v", version, dirty, err)
	}
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return ctx, New(pool), m
}
func create(t *testing.T, ctx context.Context, p *Postgres, service, key string) domain.Ticket {
	t.Helper()
	r, err := p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: demoBranch, ServiceID: service, IdempotencyKey: key})
	if err != nil || r.Replayed {
		t.Fatalf("create: %+v %v", r, err)
	}
	return r.Ticket
}
func wantError(t *testing.T, err, want error) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("error=%v want=%v", err, want)
	}
}
func execSQL(t *testing.T, ctx context.Context, p *Postgres, sql string, args ...any) {
	t.Helper()
	if _, err := p.pool.Exec(ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}
func TestPostgresCatalogAndMigration(t *testing.T) {
	ctx, p, m := integration(t)
	branches, err := p.ListBranches(ctx)
	if err != nil || len(branches) < 1 {
		t.Fatalf("branches: %v %v", len(branches), err)
	}
	var foundDemo *domain.Branch
	for i := range branches {
		if branches[i].ID == demoBranch {
			foundDemo = &branches[i]
			break
		}
	}
	if foundDemo == nil {
		t.Fatalf("demo branch %s not found in branches", demoBranch)
	}
	services, err := p.ListBranchServices(ctx, demoBranch)
	if err != nil || len(services) != 4 {
		t.Fatalf("services: %v %v", services, err)
	}
	windows, err := p.ListBranchWindows(ctx, demoBranch)
	if err != nil || len(windows) != 3 {
		t.Fatalf("windows: %v %v", windows, err)
	}
	// 000002 seeds PARCELS/PAYMENTS; 000009 adds SEND/RETAIL to the branch catalog and
	// spreads them over the demo windows. Capabilities are ordered by service code.
	ids := []string{window1, window2, window3}
	codes := [][]string{
		{"PARCELS", "RETAIL", "SEND"},
		{"PAYMENTS", "RETAIL"},
		{"PARCELS", "RETAIL", "SEND"},
	}
	for i, w := range windows {
		if w.ID != ids[i] || w.Number != i+1 || w.Status != domain.WindowStatusOpen || len(w.Services) != len(codes[i]) {
			t.Fatalf("window: %+v", w)
		}
		for j, s := range w.Services {
			if s.Code != codes[i][j] {
				t.Fatalf("window %d capability %d: %s", w.Number, j, s.Code)
			}
		}
	}
	_, err = p.ListBranchServices(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	_, err = p.ListBranchWindows(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	execSQL(t, ctx, p, `INSERT INTO branches VALUES($1,'Empty')`, missing)
	empty, err := p.ListBranchServices(ctx, missing)
	if err != nil || empty == nil || len(empty) != 0 {
		t.Fatalf("empty: %v %v", empty, err)
	}
	_, err = p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: missing, ServiceID: parcels, IdempotencyKey: "unsupported"})
	wantError(t, err, application.ErrNotFound)
	// Capability cannot reference a service not enabled for the branch.
	execSQL(t, ctx, p, `INSERT INTO windows VALUES('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',$1,1,'OPEN')`, missing)
	if _, err = p.pool.Exec(ctx, `INSERT INTO window_services VALUES('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',$1,$2)`, missing, parcels); err == nil {
		t.Fatal("invalid capability accepted")
	}
	downTo(t, m, migrationInitial)
	version, dirty, err := m.Version()
	if err != nil || version != migrationInitial || dirty {
		t.Fatalf("down: %d %v %v", version, dirty, err)
	}
	if err = m.Up(); err != nil {
		t.Fatal(err)
	}
}
func TestPostgresIdempotency(t *testing.T) {
	ctx, p, _ := integration(t)
	cmd := application.CreateQRTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "same"}
	first := create(t, ctx, p, parcels, cmd.IdempotencyKey)
	if first.Status != domain.TicketStatusWaiting || first.Source != domain.TicketSourceQR || first.Window != nil || first.PublicNumber != "Q-000001" || first.CreatedAt.IsZero() || first.QueueEnteredAt.IsZero() {
		t.Fatalf("ticket: %+v", first)
	}
	for _, changed := range []application.CreateQRTicketCommand{
		{BranchID: demoBranch, ServiceID: payments, IdempotencyKey: "same"},
		{BranchID: missing, ServiceID: parcels, IdempotencyKey: "same"},
	} {
		_, err := p.CreateQRTicket(ctx, changed)
		wantError(t, err, application.ErrIdempotencyConflict)
	}
	r, err := p.CreateQRTicket(ctx, cmd)
	if err != nil || !r.Replayed || r.Ticket.ID != first.ID {
		t.Fatalf("replay: %+v %v", r, err)
	}
	execSQL(t, ctx, p, `UPDATE tickets SET source='LIVE' WHERE id=$1::uuid`, first.ID)
	_, err = p.CreateQRTicket(ctx, cmd)
	wantError(t, err, application.ErrIdempotencyConflict)
	for _, bad := range []application.CreateQRTicketCommand{
		{BranchID: missing, ServiceID: parcels, IdempotencyKey: "missing-branch"},
		{BranchID: demoBranch, ServiceID: missing, IdempotencyKey: "missing-service"},
	} {
		_, err = p.CreateQRTicket(ctx, bad)
		wantError(t, err, application.ErrNotFound)
	}
	cmd.IdempotencyKey = " "
	_, err = p.CreateQRTicket(ctx, cmd)
	wantError(t, err, application.ErrInvalidState)
	execSQL(t, ctx, p, `SELECT setval('ticket_public_number_seq',999999)`)
	large := create(t, ctx, p, payments, "large-number")
	if large.PublicNumber != "Q-1000000" {
		t.Fatal(large.PublicNumber)
	}
}
func TestPostgresRoutingAndTransitions(t *testing.T) {
	ctx, p, _ := integration(t)
	current, err := p.GetCurrentTicket(ctx, window1)
	if err != nil || current != nil {
		t.Fatalf("idle: %v %v", current, err)
	}
	_, err = p.GetCurrentTicket(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	_, err = p.GetTicket(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	_, err = p.CallNext(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	a := create(t, ctx, p, parcels, "parcel-a")
	b := create(t, ctx, p, parcels, "parcel-b")
	_, err = p.CallNext(ctx, window2)
	wantError(t, err, application.ErrNoEligibleTickets)
	pay := create(t, ctx, p, payments, "payment")
	calledPay, err := p.CallNext(ctx, window2)
	if err != nil || calledPay.ID != pay.ID {
		t.Fatalf("payment routing: %v %v", calledPay, err)
	}
	// Test the UUID tie-breaker independently of insertion order.
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at='2026-01-01T00:00:00Z', created_at='2026-01-01T00:00:00Z' WHERE id IN ($1::uuid,$2::uuid)`, a.ID, b.ID)
	if b.ID < a.ID {
		a, b = b, a
	}
	_, err = p.StartService(ctx, a.ID)
	wantError(t, err, application.ErrInvalidState)
	_, err = p.CompleteService(ctx, a.ID)
	wantError(t, err, application.ErrInvalidState)
	called, err := p.CallNext(ctx, window1)
	if err != nil || called.ID != a.ID || called.Status != domain.TicketStatusCalled || called.CalledAt == nil || called.Window.ID != window1 {
		t.Fatalf("called: %+v %v", called, err)
	}
	current, err = p.GetCurrentTicket(ctx, window1)
	if err != nil || current == nil || current.ID != a.ID {
		t.Fatalf("current: %v %v", current, err)
	}
	_, err = p.CallNext(ctx, window1)
	wantError(t, err, application.ErrWindowBusy)
	_, err = p.CompleteService(ctx, a.ID)
	wantError(t, err, application.ErrInvalidState)
	serving, err := p.StartService(ctx, a.ID)
	if err != nil || serving.Status != domain.TicketStatusServing || serving.ServiceStartedAt == nil {
		t.Fatalf("serving: %v %v", serving, err)
	}
	_, err = p.StartService(ctx, a.ID)
	wantError(t, err, application.ErrInvalidState)
	completed, err := p.CompleteService(ctx, a.ID)
	if err != nil || completed.Status != domain.TicketStatusCompleted || completed.CompletedAt == nil {
		t.Fatalf("complete: %v %v", completed, err)
	}
	_, err = p.CompleteService(ctx, a.ID)
	wantError(t, err, application.ErrInvalidState)
	_, err = p.StartService(ctx, a.ID)
	wantError(t, err, application.ErrInvalidState)
	current, err = p.GetCurrentTicket(ctx, window1)
	if err != nil || current != nil {
		t.Fatalf("completed current: %v %v", current, err)
	}
	next, err := p.CallNext(ctx, window1)
	if err != nil || next.ID != b.ID {
		t.Fatalf("next: %v %v", next, err)
	}
	for _, status := range []string{"CLOSED", "CLOSING"} {
		execSQL(t, ctx, p, `UPDATE windows SET status=$1 WHERE id=$2::uuid`, status, window3)
		_, err = p.CallNext(ctx, window3)
		wantError(t, err, application.ErrInvalidState)
	}
	_, err = p.StartService(ctx, missing)
	wantError(t, err, application.ErrNotFound)
	_, err = p.CompleteService(ctx, missing)
	wantError(t, err, application.ErrNotFound)
}

// Barrier starts requests together; assertions cover database outcomes, not timing.
func concurrently(n int, fn func(int)) {
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) { defer wg.Done(); <-start; fn(i) }(i)
	}
	close(start)
	wg.Wait()
}
func TestPostgresConcurrentCreation(t *testing.T) {
	ctx, p, _ := integration(t)
	const n = 12
	results := make([]application.CreateQRTicketResult, n)
	errs := make([]error, n)
	concurrently(n, func(i int) {
		results[i], errs[i] = p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "concurrent"})
	})
	created := 0
	for i, r := range results {
		if errs[i] != nil {
			t.Fatal(errs[i])
		}
		if !r.Replayed {
			created++
		}
		if r.Ticket.ID != results[0].Ticket.ID {
			t.Fatal("duplicate ticket")
		}
	}
	if created != 1 {
		t.Fatalf("created=%d", created)
	}
	concurrently(n, func(i int) {
		service := parcels
		if i%2 == 1 {
			service = payments
		}
		results[i], errs[i] = p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: demoBranch, ServiceID: service, IdempotencyKey: "conflict-race"})
	})
	success, conflicts := 0, 0
	for _, err := range errs {
		if err == nil {
			success++
		} else if errors.Is(err, application.ErrIdempotencyConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if success != n/2 || conflicts != n/2 {
		t.Fatalf("success=%d conflicts=%d", success, conflicts)
	}
}
func TestPostgresConcurrentClaims(t *testing.T) {
	ctx, p, _ := integration(t)
	ticket := create(t, ctx, p, parcels, "one")
	var results [2]domain.Ticket
	var errs [2]error
	concurrently(2, func(i int) { results[i], errs[i] = p.CallNext(ctx, []string{window1, window3}[i]) })
	successes := 0
	var winner string
	for i, err := range errs {
		if err == nil {
			successes++
			winner = results[i].Window.ID
			if results[i].ID != ticket.ID {
				t.Fatal("wrong ticket")
			}
		} else {
			wantError(t, err, application.ErrNoEligibleTickets)
		}
	}
	if successes != 1 {
		t.Fatalf("assigned %d times", successes)
	}
	create(t, ctx, p, parcels, "second")
	// The partial unique index protects writes even outside CallNext.
	if _, err := p.pool.Exec(ctx, `UPDATE tickets SET status='CALLED',window_id=$1::uuid,called_at=now() WHERE idempotency_key='second'`, winner); err == nil {
		t.Fatal("two active tickets accepted")
	}
	concurrently(2, func(i int) { results[i], errs[i] = p.StartService(ctx, ticket.ID) })
	successes = 0
	for _, err := range errs {
		if err == nil {
			successes++
		} else {
			wantError(t, err, application.ErrInvalidState)
		}
	}
	if successes != 1 {
		t.Fatal("start silently overwritten")
	}
	concurrently(2, func(i int) { results[i], errs[i] = p.CompleteService(ctx, ticket.ID) })
	successes = 0
	for _, err := range errs {
		if err == nil {
			successes++
		} else {
			wantError(t, err, application.ErrInvalidState)
		}
	}
	if successes != 1 {
		t.Fatal("complete silently overwritten")
	}
	create(t, ctx, p, parcels, "third")
	concurrently(2, func(i int) { results[i], errs[i] = p.CallNext(ctx, winner) })
	successes = 0
	for _, err := range errs {
		if err == nil {
			successes++
		} else {
			wantError(t, err, application.ErrWindowBusy)
		}
	}
	if successes != 1 {
		t.Fatal("window has multiple active tickets")
	}
}

func TestPostgresFIFOAndSkipLocked(t *testing.T) {
	ctx, p, _ := integration(t)
	a := create(t, ctx, p, parcels, "first")
	b := create(t, ctx, p, parcels, "second")
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at='2026-01-01T00:00:00Z' WHERE id=$1::uuid`, a.ID)
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at='2026-01-02T00:00:00Z' WHERE id=$1::uuid`, b.ID)
	// An earlier ticket of the same global service in another branch is ineligible.
	execSQL(t, ctx, p, `INSERT INTO branches(id, name) VALUES($1, 'Other') ON CONFLICT (id) DO NOTHING`, missing)
	execSQL(t, ctx, p, `INSERT INTO branch_services(branch_id, service_id) VALUES($1, $2) ON CONFLICT DO NOTHING`, missing, parcels)
	other, err := p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: missing, ServiceID: parcels, IdempotencyKey: "other-branch"})
	if err != nil {
		t.Fatal(err)
	}
	execSQL(t, ctx, p, `UPDATE tickets SET queue_entered_at='2025-01-01T00:00:00Z' WHERE id=$1::uuid`, other.Ticket.ID)
	locker, err := p.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer locker.Rollback(context.Background())
	if _, err = locker.Exec(ctx, `SELECT id FROM tickets WHERE id=$1::uuid FOR UPDATE`, a.ID); err != nil {
		t.Fatal(err)
	}
	callCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	claimed, err := p.CallNext(callCtx, window1)
	if err != nil || claimed.ID != b.ID {
		t.Fatalf("skip locked: %+v %v", claimed, err)
	}
	if err = locker.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	claimed, err = p.CallNext(ctx, window3)
	if err != nil || claimed.ID != a.ID {
		t.Fatalf("earliest unlocked: %+v %v", claimed, err)
	}
	untouched, err := p.GetTicket(ctx, other.Ticket.ID)
	if err != nil || untouched.Status != domain.TicketStatusWaiting {
		t.Fatalf("other branch: %+v %v", untouched, err)
	}
}

func TestPostgresConcurrentDistinctClaims(t *testing.T) {
	ctx, p, _ := integration(t)
	a := create(t, ctx, p, parcels, "first")
	b := create(t, ctx, p, parcels, "second")
	var results [2]domain.Ticket
	var errs [2]error
	concurrently(2, func(i int) { results[i], errs[i] = p.CallNext(ctx, []string{window1, window3}[i]) })
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if results[0].ID == results[1].ID {
		t.Fatal("same ticket claimed twice")
	}
	for _, r := range results {
		if r.ID != a.ID && r.ID != b.ID {
			t.Fatal("unexpected ticket")
		}
	}
}

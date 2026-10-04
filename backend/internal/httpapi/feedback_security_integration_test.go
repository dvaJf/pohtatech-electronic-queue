package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"postcode/backend/internal/application"
	"postcode/backend/internal/persistence"
)

func TestFeedbackHTTPCrossTicketRealPostgres(t *testing.T) {
	dsn := os.Getenv("CORE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set CORE_TEST_DATABASE_URL for real HTTP/PostgreSQL integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	var nonce [12]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		t.Fatal(err)
	}
	schema := "feedback_http_" + hex.EncodeToString(nonce[:])
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error(err)
		}
	}()
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
	defer m.Close()
	if err = m.Up(); err != nil {
		t.Fatal(err)
	}
	pool, err := pgxpool.New(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	core := persistence.New(pool)
	router := NewRouter(pool, core, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	// Finish each visit through the supported lifecycle, leaving no queued
	// ticket that could change the next fixture's CallNext result.
	createCompleted := func(key string) (string, string) {
		t.Helper()
		result, err := core.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: apiBranch, ServiceID: apiService, IdempotencyKey: key})
		if err != nil {
			t.Fatal(err)
		}
		ticket := result.Ticket
		if ticket.ManagementToken == nil || *ticket.ManagementToken == "" {
			t.Fatal("missing management token")
		}
		called, err := core.CallNext(ctx, "33333333-3333-3333-3333-333333333333")
		if err != nil || called.ID != ticket.ID {
			t.Fatalf("call: %v %v", called.ID, err)
		}
		if _, err = core.StartService(ctx, ticket.ID); err != nil {
			t.Fatal(err)
		}
		if _, err = core.CompleteService(ctx, ticket.ID); err != nil {
			t.Fatal(err)
		}
		return ticket.ID, *ticket.ManagementToken
	}
	a, tokenA := createCompleted("http-feedback-a")
	b, tokenB := createCompleted("http-feedback-b")
	if tokenA == tokenB {
		t.Fatal("fixture tokens must differ")
	}
	submit := func(id, token string, expected int) {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/v1/tickets/"+id+"/feedback", strings.NewReader(`{"rating":5,"comment":"cross-ticket test"}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Ticket-Manage-Token", token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Code != expected {
			t.Fatalf("HTTP %d: %s; want %d", response.Code, response.Body.String(), expected)
		}
		t.Logf("HTTP feedback status=%d", response.Code)
	}
	rows := func(id string, want int) {
		t.Helper()
		var n int
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM ticket_feedback WHERE ticket_id=$1::uuid`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != want {
			t.Fatalf("feedback rows=%d want=%d", n, want)
		}
		t.Logf("feedback rows=%d", n)
	}
	submit(b, tokenA, http.StatusForbidden)
	rows(b, 0)
	submit(a, tokenB, http.StatusForbidden)
	rows(a, 0)
	submit(b, tokenB, http.StatusOK)
	rows(b, 1)
	var ticketID, comment string
	var rating int
	if err := pool.QueryRow(ctx, `SELECT ticket_id::text,rating,comment FROM ticket_feedback WHERE ticket_id=$1::uuid`, b).Scan(&ticketID, &rating, &comment); err != nil {
		t.Fatal(err)
	}
	if ticketID != b || rating != 5 || comment != "cross-ticket test" {
		t.Fatalf("stored feedback: ticket=%s rating=%d comment=%q", ticketID, rating, comment)
	}
}

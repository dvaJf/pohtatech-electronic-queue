package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"postcode/backend/internal/domain"
	"postcode/backend/internal/persistence"
)

// Real production router and Core; SQL is restricted to isolated schema setup.
func TestSprint3HTTPRealCore(t *testing.T) {
	dsn := os.Getenv("CORE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set CORE_TEST_DATABASE_URL for real Core HTTP integration")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
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
	schema := "api_test_" + hex.EncodeToString(nonce[:])
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	defer func() {
		clean, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		if _, err := admin.Exec(clean, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
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
	h := NewRouter(pool, core, slog.New(slog.NewTextHandler(io.Discard, nil)), "")
	request3(t, h, "GET", policyURL, "", "", 401)
	user, err := core.Register(ctx, "integration@example.invalid", schema)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = core.ChangeUserRole(ctx, user.ID, domain.RoleOPCChief); err != nil {
		t.Fatal(err)
	}
	loginBody, _ := json.Marshal(map[string]string{"email": user.Email, "password": schema})
	loggedIn := request3(t, h, "POST", "/api/v1/auth/login", string(loginBody), "", 200)
	cookies := loggedIn.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly {
		t.Fatal("missing HttpOnly session")
	}
	router := h
	h = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { r.AddCookie(cookies[0]); router.ServeHTTP(w, r) })
	w := request3(t, h, "GET", policyURL, "", "", 200)
	var policy QueuePolicyDTO
	json.Unmarshal(w.Body.Bytes(), &policy)
	if policy.Version != 2 || policy.LivePriority != 10 || policy.AppointmentLatePenaltyMaxPoints != 90 {
		t.Fatal(policy)
	}
	legacy := `{"appointmentDuePriority":200,"qrPriority":20,"expectedVersion":2}`
	w = request3(t, h, "PUT", policyURL, legacy, "", 200)
	json.Unmarshal(w.Body.Bytes(), &policy)
	if policy.Version != 3 || policy.LivePriority != 10 || policy.AntiStarvationPointsPerMinute != 10 {
		t.Fatal(policy)
	}
	request3(t, h, "PUT", policyURL, legacy, "", 409)
	request3(t, h, "PUT", policyURL, `{"appointmentDuePriority":10,"qrPriority":20,"expectedVersion":3}`, "", 400)
	full := `{"appointmentDuePriority":100,"qrPriority":10,"livePriority":10,"antiStarvationThresholdMinutes":15,"antiStarvationPointsPerMinute":10,"appointmentGraceMinutes":15,"appointmentLatePenaltyPerMinute":5,"appointmentLatePenaltyMaxPoints":90,"expectedVersion":3}`
	request3(t, h, "PUT", policyURL, full, "", 200)
	livePath := "/api/v1/operator/branches/" + apiBranch + "/tickets/live"
	body := `{"serviceId":"` + apiService + `"}`
	w = request3(t, h, "POST", livePath, body, "live", 201)
	var live TicketDTO
	json.Unmarshal(w.Body.Bytes(), &live)
	if live.Source != "LIVE" || live.Status != "WAITING" || live.Window != nil {
		t.Fatal(live)
	}
	w = request3(t, h, "POST", livePath, body, "live", 200)
	var replay TicketDTO
	json.Unmarshal(w.Body.Bytes(), &replay)
	if replay.ID != live.ID {
		t.Fatal(replay)
	}
	request3(t, h, "POST", livePath, `{"serviceId":"55555555-5555-5555-5555-555555555555"}`, "live", 409)
	w = request3(t, h, "GET", "/api/v1/tickets/"+live.ID+"/position", "", "", 200)
	var pos QueuePositionDTO
	json.Unmarshal(w.Body.Bytes(), &pos)
	if pos.Reason != "AVAILABLE" || *pos.Position != 1 {
		t.Fatal(pos)
	}
	call := "/api/v1/operator/windows/33333333-3333-3333-3333-333333333333/call-next"
	request3(t, h, "POST", call, "", "", 200)
	for i := 0; i < 2; i++ {
		request3(t, h, "POST", "/api/v1/operator/tickets/"+live.ID+"/no-show", "", "", 200)
	}
	request3(t, h, "POST", "/api/v1/operator/tickets/"+live.ID+"/start", "", "", 409)
	w = request3(t, h, "GET", "/api/v1/admin/tickets/"+live.ID+"/events", "", "", 200)
	var events ListTicketEventsResponse
	json.Unmarshal(w.Body.Bytes(), &events)
	if len(events.Items) != 3 || events.Items[2].Type != "NO_SHOW" || *events.Items[1].PolicyVersion != 4 {
		t.Fatal(events)
	}
	// The old QR Call/Start/Complete flow still uses the same production router.
	w = request3(t, h, "POST", "/api/v1/branches/"+apiBranch+"/tickets/qr", body, "qr", 201)
	var qr TicketDTO
	json.Unmarshal(w.Body.Bytes(), &qr)
	request3(t, h, "POST", call, "", "", 200)
	request3(t, h, "POST", "/api/v1/operator/tickets/"+qr.ID+"/start", "", "", 200)
	request3(t, h, "POST", "/api/v1/operator/tickets/"+qr.ID+"/complete", "", "", 200)
	scheduled := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	w = request3(t, h, "POST", "/api/v1/appointments", `{"branchId":"`+apiBranch+`","serviceId":"`+apiService+`","scheduledAt":"`+scheduled+`"}`, "appt", 201)
	var appt AppointmentResponse
	json.Unmarshal(w.Body.Bytes(), &appt)
	request3(t, h, "POST", "/api/v1/appointments/"+appt.Ticket.ID+"/test-confirm", "", "", 200)
	for i := 0; i < 2; i++ {
		request3(t, h, "POST", "/api/v1/appointments/"+appt.Ticket.ID+"/arrive", "", "", 200)
	}
	w = request3(t, h, "GET", "/api/v1/tickets/"+appt.Ticket.ID+"/position", "", "", 200)
	json.Unmarshal(w.Body.Bytes(), &pos)
	// Early arrival is eligible immediately with live-queue rank (current due_at policy).
	if pos.Reason != "AVAILABLE" || pos.Position == nil || *pos.Position != 1 {
		t.Fatal(pos)
	}
	w = request3(t, h, "GET", "/api/v1/admin/tickets/"+appt.Ticket.ID+"/events", "", "", 200)
	json.Unmarshal(w.Body.Bytes(), &events)
	if len(events.Items) != 3 || events.Items[2].Type != "ARRIVED" {
		t.Fatal(events)
	}
	request3(t, h, "POST", "/api/v1/appointments/"+appt.Ticket.ID+"/cancel", "", "", 200)
	request3(t, h, "POST", "/api/v1/appointments/"+appt.Ticket.ID+"/arrive", "", "", 409)
}

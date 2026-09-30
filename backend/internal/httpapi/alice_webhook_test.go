package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
	"postcode/backend/internal/integrations/alice"
)

func TestAliceWebhook_EndToEnd(t *testing.T) {
	lat := 55.75231
	lng := 37.59842
	fake := &FakeUseCases{
		ListBranchesFunc: func(ctx context.Context) ([]domain.Branch, error) {
			return []domain.Branch{
				{
					ID:        "branch-test-1",
					Name:      "Отделение Новый Арбат",
					Address:   "ул. Новый Арбат, д. 2",
					Latitude:  &lat,
					Longitude: &lng,
				},
			}, nil
		},
		ListBranchServicesFunc: func(ctx context.Context, branchID string) ([]domain.Service, error) {
			return []domain.Service{{ID: "srv-1", Code: "PARCEL", Name: "Посылки"}}, nil
		},
		GetBranchWorkloadFunc: func(ctx context.Context, branchID string) (domain.BranchWorkload, error) {
			wait := 120
			return domain.BranchWorkload{EstimatedWaitSeconds: &wait, ActiveWindows: 2}, nil
		},
		CreateLiveTicketFunc: func(ctx context.Context, cmd application.CreateLiveTicketCommand) (application.CreateLiveTicketResult, error) {
			return application.CreateLiveTicketResult{
				Ticket: domain.Ticket{
					ID:           "ticket-101",
					PublicNumber: "Q-101010",
					Status:       domain.TicketStatusWaiting,
				},
			}, nil
		},
		CreateAppointmentFunc: func(ctx context.Context, cmd application.CreateAppointmentCommand) (application.CreateAppointmentResult, error) {
			return application.CreateAppointmentResult{
				Appointment: application.AppointmentView{
					Ticket: domain.Ticket{
						ID:           "ticket-apt-1",
						PublicNumber: "A-000303",
						Status:       domain.TicketStatusScheduled,
					},
					ScheduledAt: cmd.ScheduledAt,
				},
			}, nil
		},
		GetQueuePositionFunc: func(ctx context.Context, ticketID string) (domain.QueuePosition, error) {
			pos := 3
			return domain.QueuePosition{TicketID: ticketID, Position: &pos}, nil
		},
	}

	router := NewRouter(&fakePinger{}, fake, slog.Default(), "*")

	// 1. User says: "Запиши меня на почту" without specific time -> Alice prompts for date/time
	body1 := alice.AliceRequest{
		Session: alice.AliceSession{
			SessionID: "test-session-1",
			MessageID: 1,
			User:      &alice.AliceUser{UserID: "alice-user-1"},
		},
		Request: alice.AliceReqBody{
			Command: "запиши меня на почту",
			Type:    "SimpleUtterance",
		},
		Version: "1.0",
	}
	raw1, _ := json.Marshal(body1)

	req1 := httptest.NewRequest(http.MethodPost, "/api/v1/integrations/alice/webhook", bytes.NewReader(raw1))
	req1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()

	router.ServeHTTP(w1, req1)
	if w1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w1.Code, w1.Body.String())
	}

	var resp1 alice.AliceResponse
	if err := json.Unmarshal(w1.Body.Bytes(), &resp1); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !strings.Contains(resp1.Response.Text, "предварительная онлайн-запись") {
		t.Errorf("unexpected response text: %s", resp1.Response.Text)
	}

	// 2. User specifies time: "Запиши меня на 15:30"
	body2 := alice.AliceRequest{
		Session: alice.AliceSession{
			SessionID: "test-session-1",
			MessageID: 2,
			User:      &alice.AliceUser{UserID: "alice-user-1"},
		},
		Request: alice.AliceReqBody{
			Command: "запиши меня на 15:30",
			Type:    "SimpleUtterance",
		},
		Version: "1.0",
	}
	raw2, _ := json.Marshal(body2)

	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/integrations/alice/webhook", bytes.NewReader(raw2))
	req2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()

	router.ServeHTTP(w2, req2)
	if w2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w2.Code, w2.Body.String())
	}

	var resp2 alice.AliceResponse
	if err := json.Unmarshal(w2.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !strings.Contains(resp2.Response.Text, "15:30") || !strings.Contains(resp2.Response.Text, "Подтверждаете?") {
		t.Errorf("expected appointment confirmation prompt for 15:30, got: %s", resp2.Response.Text)
	}
	if resp2.SessionState == nil || resp2.SessionState["pending_action"] == nil {
		t.Fatalf("expected session_state.pending_action in Alice response")
	}

	// 3. User confirms: "Да"
	body3 := alice.AliceRequest{
		Session: alice.AliceSession{
			SessionID: "test-session-1",
			MessageID: 3,
			User:      &alice.AliceUser{UserID: "alice-user-1"},
		},
		Request: alice.AliceReqBody{
			Command: "да",
			Type:    "SimpleUtterance",
		},
		State: &alice.AliceState{
			Session: resp2.SessionState,
		},
		Version: "1.0",
	}
	raw3, _ := json.Marshal(body3)

	req3 := httptest.NewRequest(http.MethodPost, "/api/v1/integrations/alice/webhook", bytes.NewReader(raw3))
	req3.Header.Set("Content-Type", "application/json")
	w3 := httptest.NewRecorder()

	router.ServeHTTP(w3, req3)
	if w3.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on confirm, got %d: %s", w3.Code, w3.Body.String())
	}

	var resp3 alice.AliceResponse
	if err := json.Unmarshal(w3.Body.Bytes(), &resp3); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if !strings.Contains(resp3.Response.Text, "A-000303") {
		t.Errorf("expected appointment ticket A-000303 in response, got: %s", resp3.Response.Text)
	}
}

func TestAliceWebhook_InvalidJSONFallback(t *testing.T) {
	fake := &FakeUseCases{}
	router := NewRouter(&fakePinger{}, fake, slog.Default(), "*")

	req := httptest.NewRequest(http.MethodPost, "/api/v1/integrations/alice/webhook", strings.NewReader("invalid-json-body"))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	router.ServeHTTP(w, req)
	// Must return 200 OK to Yandex Alice with speech fallback, not 500!
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK fallback, got %d", w.Code)
	}

	var resp alice.AliceResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode fallback: %v", err)
	}
	if !strings.Contains(resp.Response.Text, "ошибка при обработке") {
		t.Errorf("expected error speech, got: %s", resp.Response.Text)
	}
}

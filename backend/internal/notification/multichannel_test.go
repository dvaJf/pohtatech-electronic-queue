package notification

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
	"postcode/backend/internal/domain"
)

type mockSubscriptionDisabler struct {
	*memoryOutboxRepo
	mu        sync.Mutex
	disabledIDs []string
}

func newMockSubscriptionDisabler() *mockSubscriptionDisabler {
	return &mockSubscriptionDisabler{
		memoryOutboxRepo: newMemoryOutboxRepo(),
	}
}

func (m *mockSubscriptionDisabler) DisableSubscriptionByID(ctx context.Context, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.disabledIDs = append(m.disabledIDs, id)
	return nil
}

func TestTelegramSender_FormattingAndDelivery(t *testing.T) {
	var receivedBody map[string]string
	var receivedPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedPath = r.URL.Path
		data, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(data, &receivedBody)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	t.Setenv("TELEGRAM_BOT_TOKEN", "mock-token-999")

	sender := &MultiSender{
		http: srv.Client(),
	}

	// 1. TICKET_NEAR_TURN
	mNear := domain.NotificationMessage{
		Channel:      domain.NotificationChannelTelegram,
		Destination:  "12345",
		EventType:    domain.NotificationTicketNearTurn,
		PublicNumber: "Q-0001",
		Body:         "Перед вами осталось 2 человека.\nПора заходить в отделение.",
	}
	// We override http request destination by pointing to mock server
	body, _ := json.Marshal(map[string]string{"chat_id": mNear.Destination, "text": telegramText(mNear)})
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, srv.URL+"/botmock-token-999/sendMessage", strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := sender.http.Do(req)
	if err != nil {
		t.Fatalf("telegram request failed: %v", err)
	}
	defer resp.Body.Close()

	if !strings.Contains(receivedPath, "mock-token-999") {
		t.Fatalf("expected bot token in path, got: %s", receivedPath)
	}
	if !strings.Contains(receivedBody["text"], "Скоро ваша очередь") {
		t.Fatalf("expected near-turn header in text, got: %s", receivedBody["text"])
	}
	if !strings.Contains(receivedBody["text"], "Перед вами осталось 2 человека") {
		t.Fatalf("expected ahead text, got: %s", receivedBody["text"])
	}

	// 2. TICKET_CALLED
	mCalled := domain.NotificationMessage{
		Channel:      domain.NotificationChannelTelegram,
		Destination:  "12345",
		EventType:    domain.NotificationTicketCalled,
		PublicNumber: "Q-0042",
		WindowNumber: 3,
		ServiceName:  "Посылки",
	}
	calledTxt := telegramText(mCalled)
	if !strings.Contains(calledTxt, "Вас вызывают") {
		t.Fatalf("expected 'Вас вызывают', got: %s", calledTxt)
	}
	if !strings.Contains(calledTxt, "Талон Q-0042") {
		t.Fatalf("expected 'Талон Q-0042', got: %s", calledTxt)
	}
	if !strings.Contains(calledTxt, "Окно №3") {
		t.Fatalf("expected 'Окно №3', got: %s", calledTxt)
	}
	if !strings.Contains(calledTxt, "Услуга: Посылки") {
		t.Fatalf("expected 'Услуга: Посылки', got: %s", calledTxt)
	}
}

func TestTelegramSender_FailureClassification(t *testing.T) {
	statusCode := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(statusCode)
	}))
	defer srv.Close()

	// 400 Bad Request -> PermanentError
	statusCode = http.StatusBadRequest
	resp, _ := srv.Client().Get(srv.URL)
	resp.Body.Close()
	if resp.StatusCode == 400 || resp.StatusCode == 403 {
		err := PermanentError{fmt.Errorf("telegram returned HTTP %d", resp.StatusCode)}
		if !IsPermanent(err) {
			t.Fatal("expected 400 to be permanent error")
		}
	}

	// 403 Forbidden -> PermanentError
	statusCode = http.StatusForbidden
	resp, _ = srv.Client().Get(srv.URL)
	resp.Body.Close()
	if resp.StatusCode == 400 || resp.StatusCode == 403 {
		err := PermanentError{fmt.Errorf("telegram returned HTTP %d", resp.StatusCode)}
		if !IsPermanent(err) {
			t.Fatal("expected 403 to be permanent error")
		}
	}

	// 429 Too Many Requests -> Retryable (not permanent)
	statusCode = http.StatusTooManyRequests
	resp, _ = srv.Client().Get(srv.URL)
	resp.Body.Close()
	if resp.StatusCode == 429 {
		err := fmt.Errorf("telegram returned HTTP %d", resp.StatusCode)
		if IsPermanent(err) {
			t.Fatal("expected 429 to be retryable, not permanent")
		}
	}

	// 502 Bad Gateway -> Retryable (not permanent)
	statusCode = http.StatusBadGateway
	resp, _ = srv.Client().Get(srv.URL)
	resp.Body.Close()
	if resp.StatusCode >= 500 {
		err := fmt.Errorf("telegram returned HTTP %d", resp.StatusCode)
		if IsPermanent(err) {
			t.Fatal("expected 502 to be retryable, not permanent")
		}
	}
}

func TestWebPush_FailureClassificationAndWorkerAction(t *testing.T) {
	priv, pub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("GenerateVAPIDKeys failed: %v", err)
	}

	statusCode := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(statusCode)
	}))
	defer srv.Close()

	t.Setenv("WEB_PUSH_VAPID_PUBLIC_KEY", pub)
	t.Setenv("WEB_PUSH_VAPID_PRIVATE_KEY", priv)
	t.Setenv("WEB_PUSH_CONTACT", "mailto:admin@example.com")

	sender := NewMultiSender("http://demo:8082", 2*time.Second)

	_, clientPub, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatalf("Generate client keys failed: %v", err)
	}

	subJSON := fmt.Sprintf(`{"endpoint":"%s","keys":{"auth":"eHh4eHh4eHh4eHh4eHh4eA","p256dh":"%s"}}`, srv.URL, clientPub)

	// 1. 410 Gone -> PermanentError
	statusCode = http.StatusGone
	err410 := sender.Send(context.Background(), domain.NotificationMessage{
		Channel:     domain.NotificationChannelWebPush,
		Destination: subJSON,
		EventType:   domain.NotificationTicketCalled,
	})
	if err410 == nil || !IsPermanent(err410) {
		t.Fatalf("expected 410 Gone to be PermanentError, got: %v", err410)
	}

	// 2. 404 Not Found -> PermanentError
	statusCode = http.StatusNotFound
	err404 := sender.Send(context.Background(), domain.NotificationMessage{
		Channel:     domain.NotificationChannelWebPush,
		Destination: subJSON,
		EventType:   domain.NotificationTicketCalled,
	})
	if err404 == nil || !IsPermanent(err404) {
		t.Fatalf("expected 404 Not Found to be PermanentError, got: %v", err404)
	}

	// 3. 429 Too Many Requests -> Retryable
	statusCode = http.StatusTooManyRequests
	err429 := sender.Send(context.Background(), domain.NotificationMessage{
		Channel:     domain.NotificationChannelWebPush,
		Destination: subJSON,
		EventType:   domain.NotificationTicketCalled,
	})
	if err429 == nil || IsPermanent(err429) {
		t.Fatalf("expected 429 to be retryable (non-permanent), got: %v", err429)
	}

	// 4. 500 Internal Error -> Retryable
	statusCode = http.StatusInternalServerError
	err500 := sender.Send(context.Background(), domain.NotificationMessage{
		Channel:     domain.NotificationChannelWebPush,
		Destination: subJSON,
		EventType:   domain.NotificationTicketCalled,
	})
	if err500 == nil || IsPermanent(err500) {
		t.Fatalf("expected 500 to be retryable, got: %v", err500)
	}

	// 5. OutboxWorker permanent error disables subscription
	repo := newMockSubscriptionDisabler()
	subID := "sub-to-disable-999"
	repo.add(domain.NotificationOutboxItem{
		ID:             "msg-perm-1",
		TicketID:       "tkt-1",
		Channel:        domain.NotificationChannelWebPush,
		SubscriptionID: &subID,
		Destination:    subJSON,
		EventType:      domain.NotificationTicketCalled,
		Payload:        `{"id":"msg-perm-1"}`,
		Status:         domain.NotificationStatusPending,
		NextAttemptAt:  time.Now().Add(-1 * time.Second),
	})

	worker := NewOutboxWorker(repo, sender, nil, WorkerConfig{
		MaxAttempts:    3,
		InitialBackoff: 10 * time.Millisecond,
	})

	statusCode = http.StatusGone
	processed, err := worker.ProcessOnce(context.Background())
	if err != nil {
		t.Fatalf("ProcessOnce failed: %v", err)
	}
	if processed != 1 {
		t.Fatalf("expected 1 processed, got %d", processed)
	}

	repo.mu.Lock()
	disabledList := repo.disabledIDs
	item := repo.items["msg-perm-1"]
	repo.mu.Unlock()

	if item.Status != domain.NotificationStatusFailed {
		t.Fatalf("expected item to be marked FAILED immediately on permanent error, got %s", item.Status)
	}
	if len(disabledList) != 1 || disabledList[0] != subID {
		t.Fatalf("expected subscription %s to be disabled, got %v", subID, disabledList)
	}
}

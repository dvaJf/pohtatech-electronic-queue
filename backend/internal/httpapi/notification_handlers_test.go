package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"postcode/backend/internal/domain"
)

type fakePinger struct{}

func (f *fakePinger) Ping(ctx context.Context) error { return nil }

type fakeNotificationStore struct {
	FakeUseCases
	listSubscriptions      func(ctx context.Context, ticketID string) ([]domain.NotificationSubscription, error)
	upsertSubscription    func(ctx context.Context, ticketID string, channel domain.NotificationChannel, destination string) (domain.NotificationSubscription, error)
	disableSubscription   func(ctx context.Context, ticketID, channel, subscriptionID string) error
	createTelegramLink     func(ctx context.Context, ticketID string) (string, error)
	consumeTelegramLink    func(ctx context.Context, token, chatID string) (domain.NotificationSubscription, error)
	disableTelegramForChat func(ctx context.Context, chatID string) error
}

func (f *fakeNotificationStore) ListNotificationSubscriptions(ctx context.Context, ticketID string) ([]domain.NotificationSubscription, error) {
	if f.listSubscriptions != nil {
		return f.listSubscriptions(ctx, ticketID)
	}
	return nil, nil
}

func (f *fakeNotificationStore) UpsertNotificationSubscription(ctx context.Context, ticketID string, channel domain.NotificationChannel, destination string) (domain.NotificationSubscription, error) {
	if f.upsertSubscription != nil {
		return f.upsertSubscription(ctx, ticketID, channel, destination)
	}
	return domain.NotificationSubscription{}, nil
}

func (f *fakeNotificationStore) DisableNotificationSubscription(ctx context.Context, ticketID, channel, subscriptionID string) error {
	if f.disableSubscription != nil {
		return f.disableSubscription(ctx, ticketID, channel, subscriptionID)
	}
	return nil
}

func (f *fakeNotificationStore) CreateTelegramLink(ctx context.Context, ticketID string) (string, error) {
	if f.createTelegramLink != nil {
		return f.createTelegramLink(ctx, ticketID)
	}
	return "mock-token-123", nil
}

func (f *fakeNotificationStore) ConsumeTelegramLink(ctx context.Context, token, chatID string) (domain.NotificationSubscription, error) {
	if f.consumeTelegramLink != nil {
		return f.consumeTelegramLink(ctx, token, chatID)
	}
	return domain.NotificationSubscription{Channel: domain.NotificationChannelTelegram, Destination: chatID, Enabled: true}, nil
}

func (f *fakeNotificationStore) DisableTelegramForChat(ctx context.Context, chatID string) error {
	if f.disableTelegramForChat != nil {
		return f.disableTelegramForChat(ctx, chatID)
	}
	return nil
}

func TestNotificationCapabilities_IndependentProviderStates(t *testing.T) {
	store := &fakeNotificationStore{}
	router := NewRouter(&fakePinger{}, store, slog.Default(), "http://localhost:5173")

	// 1. Both unconfigured
	t.Setenv("TELEGRAM_BOT_TOKEN", "")
	t.Setenv("TELEGRAM_BOT_USERNAME", "")
	t.Setenv("WEB_PUSH_VAPID_PUBLIC_KEY", "")
	t.Setenv("WEB_PUSH_VAPID_PRIVATE_KEY", "")
	t.Setenv("WEB_PUSH_CONTACT", "")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/notification-capabilities", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var caps struct {
		Telegram struct {
			Enabled bool `json:"enabled"`
		} `json:"telegram"`
		WebPush struct {
			Enabled        bool    `json:"enabled"`
			VapidPublicKey *string `json:"vapidPublicKey"`
		} `json:"webPush"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &caps); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if caps.Telegram.Enabled {
		t.Fatal("expected telegram disabled")
	}
	if caps.WebPush.Enabled {
		t.Fatal("expected web push disabled")
	}

	// 2. Telegram configured, WebPush unconfigured -> Telegram enabled, WebPush remains disabled
	t.Setenv("TELEGRAM_BOT_TOKEN", "mock-token")
	t.Setenv("TELEGRAM_BOT_USERNAME", "MockBot")

	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req)
	_ = json.Unmarshal(rec2.Body.Bytes(), &caps)
	if !caps.Telegram.Enabled {
		t.Fatal("expected telegram enabled")
	}
	if caps.WebPush.Enabled {
		t.Fatal("expected web push disabled")
	}

	// 3. WebPush configured, Telegram unconfigured -> WebPush enabled with public key, Telegram disabled
	t.Setenv("TELEGRAM_BOT_TOKEN", "")
	t.Setenv("TELEGRAM_BOT_USERNAME", "")
	t.Setenv("WEB_PUSH_VAPID_PUBLIC_KEY", "mock-pub-key-123")
	t.Setenv("WEB_PUSH_VAPID_PRIVATE_KEY", "mock-priv-key")
	t.Setenv("WEB_PUSH_CONTACT", "mailto:test@example.com")

	rec3 := httptest.NewRecorder()
	router.ServeHTTP(rec3, req)
	_ = json.Unmarshal(rec3.Body.Bytes(), &caps)
	if caps.Telegram.Enabled {
		t.Fatal("expected telegram disabled")
	}
	if !caps.WebPush.Enabled {
		t.Fatal("expected web push enabled")
	}
	if caps.WebPush.VapidPublicKey == nil || *caps.WebPush.VapidPublicKey != "mock-pub-key-123" {
		t.Fatalf("expected vapidPublicKey 'mock-pub-key-123', got %v", caps.WebPush.VapidPublicKey)
	}
}

func TestTelegramWebhook_SecretRejectionAndExecution(t *testing.T) {
	consumedToken := ""
	consumedChatID := ""
	stoppedChatID := ""

	store := &fakeNotificationStore{
		consumeTelegramLink: func(ctx context.Context, token, chatID string) (domain.NotificationSubscription, error) {
			consumedToken = token
			consumedChatID = chatID
			return domain.NotificationSubscription{Channel: domain.NotificationChannelTelegram, Destination: chatID, Enabled: true}, nil
		},
		disableTelegramForChat: func(ctx context.Context, chatID string) error {
			stoppedChatID = chatID
			return nil
		},
	}
	router := NewRouter(&fakePinger{}, store, slog.Default(), "http://localhost:5173")

	t.Setenv("TELEGRAM_WEBHOOK_SECRET", "super-secret-123")

	// Missing secret header -> 401
	body := bytes.NewReader([]byte(`{"message":{"text":"/start tok123","chat":{"id":99999}}}`))
	req := httptest.NewRequest(http.MethodPost, "/integrations/telegram/webhook", body)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for missing secret, got %d", rec.Code)
	}

	// Wrong secret header -> 401
	body = bytes.NewReader([]byte(`{"message":{"text":"/start tok123","chat":{"id":99999}}}`))
	req = httptest.NewRequest(http.MethodPost, "/integrations/telegram/webhook", body)
	req.Header.Set("X-Telegram-Bot-Api-Secret-Token", "wrong-secret")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for wrong secret, got %d", rec.Code)
	}

	// Valid secret header and /start token -> 200 and consumed
	body = bytes.NewReader([]byte(`{"message":{"text":"/start tok123","chat":{"id":99999}}}`))
	req = httptest.NewRequest(http.MethodPost, "/integrations/telegram/webhook", body)
	req.Header.Set("X-Telegram-Bot-Api-Secret-Token", "super-secret-123")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rec.Code)
	}
	if consumedToken != "tok123" || consumedChatID != "99999" {
		t.Fatalf("expected consumed tok123 and 99999, got tok=%s chat=%s", consumedToken, consumedChatID)
	}

	// Valid secret header and /stop -> 200 and disabled
	body = bytes.NewReader([]byte(`{"message":{"text":"/stop","chat":{"id":88888}}}`))
	req = httptest.NewRequest(http.MethodPost, "/api/v1/integrations/telegram/webhook", body)
	req.Header.Set("X-Telegram-Bot-Api-Secret-Token", "super-secret-123")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK via /api/v1 alias, got %d", rec.Code)
	}
	if stoppedChatID != "88888" {
		t.Fatalf("expected stopped chat 88888, got %s", stoppedChatID)
	}
}

func TestTelegramLink_CreationRequiresConfiguredUsername(t *testing.T) {
	store := &fakeNotificationStore{
		createTelegramLink: func(ctx context.Context, ticketID string) (string, error) {
			return "opaque-token-abc", nil
		},
	}
	router := NewRouter(&fakePinger{}, store, slog.Default(), "http://localhost:5173")

	// Unconfigured bot username -> 503 Provider Unavailable
	t.Setenv("TELEGRAM_BOT_USERNAME", "")
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tickets/11111111-1111-1111-1111-111111111111/notifications/telegram/link", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when bot username missing, got %d", rec.Code)
	}

	// Configured bot username -> 201 Created with deep link
	t.Setenv("TELEGRAM_BOT_USERNAME", "@PochtaTestBot")
	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/tickets/11111111-1111-1111-1111-111111111111/notifications/telegram/link", nil)
	rec2 := httptest.NewRecorder()
	router.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d", rec2.Code)
	}
	var res map[string]string
	_ = json.Unmarshal(rec2.Body.Bytes(), &res)
	expectedURL := "https://t.me/PochtaTestBot?start=opaque-token-abc"
	if res["url"] != expectedURL {
		t.Fatalf("expected URL %s, got %s", expectedURL, res["url"])
	}
}

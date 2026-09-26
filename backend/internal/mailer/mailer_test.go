package mailer

import (
	"context"
	"os"
	"testing"
)

func TestMailer_MockMode(t *testing.T) {
	m := New(Config{}) // empty user/password => mock
	err := m.SendConfirmationEmail(context.Background(), "test@example.com", "123456", "test-token")
	if err != nil {
		t.Fatalf("expected nil error in mock mode, got %v", err)
	}
}

func TestMailer_Validation(t *testing.T) {
	m := New(Config{})
	err := m.SendConfirmationEmail(context.Background(), "", "123456", "test-token")
	if err == nil {
		t.Fatalf("expected error for empty recipient email")
	}
}

func TestMailer_LiveYandexSMTP(t *testing.T) {
	if os.Getenv("SMTP_USER") == "" || os.Getenv("SMTP_PASSWORD") == "" {
		t.Skip("SMTP credentials not provided in environment, skipping live test")
	}
	cfg := ConfigFromEnv()
	m := New(cfg)
	err := m.SendConfirmationEmail(context.Background(), cfg.User, "749103", "test-token-777")
	if err != nil {
		t.Fatalf("Live Yandex SMTP failed: %v", err)
	}
	t.Log("REAL EMAIL DELIVERED TO YANDEX SUCCESSFULLY!")
}

package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"postcode/backend/internal/domain"
	"postcode/backend/internal/mailer"
	"postcode/backend/internal/sms"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type PermanentError struct{ error }

func IsPermanent(err error) bool { _, ok := err.(PermanentError); return ok }

// MultiSender selects an adapter after the outbox transaction has committed.
type MultiSender struct {
	demo NotificationSender
	http *http.Client
	sms  *sms.Client
	mail *mailer.Mailer
}

func NewMultiSender(url string, timeout time.Duration) *MultiSender {
	return &MultiSender{demo: NewHTTPSender(url, timeout), http: &http.Client{Timeout: timeout}, sms: sms.NewClient(nil), mail: mailer.New(mailer.ConfigFromEnv())}
}
func (s *MultiSender) Send(ctx context.Context, m domain.NotificationMessage) error {
	switch m.Channel {
	case domain.NotificationChannelTelegram:
		return s.telegram(ctx, m)
	case domain.NotificationChannelSMS:
		if _, err := sms.NormalizePhone(m.Destination); err != nil {
			return PermanentError{err}
		}
		return s.sms.Send(ctx, m.Destination, text(m))
	case domain.NotificationChannelEmail:
		return s.email(ctx, m)
	case domain.NotificationChannelWebPush:
		return s.webPush(ctx, m)
	default:
		return s.demo.Send(ctx, m) // WEB_PUSH is delivered to the demo adapter until VAPID credentials are configured.
	}
}
func text(m domain.NotificationMessage) string {
	if m.Body != "" {
		return m.Body
	}
	return fmt.Sprintf("Талон %s: %s", m.PublicNumber, m.EventType)
}

func telegramText(m domain.NotificationMessage) string {
	switch m.EventType {
	case domain.NotificationTicketNearTurn:
		body := m.Body
		if body == "" {
			body = "Пора заходить в отделение."
		}
		return "Скоро ваша очередь\n\n" + body
	case domain.NotificationTicketCalled:
		winStr := ""
		if m.WindowNumber > 0 {
			winStr = fmt.Sprintf("\nОкно №%d", m.WindowNumber)
		}
		serviceStr := ""
		if m.ServiceName != "" {
			serviceStr = fmt.Sprintf("\nУслуга: %s", m.ServiceName)
		}
		return fmt.Sprintf("Вас вызывают\nТалон %s%s%s", m.PublicNumber, winStr, serviceStr)
	default:
		return text(m)
	}
}

func (s *MultiSender) telegram(ctx context.Context, m domain.NotificationMessage) error {
	token := strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN"))
	if token == "" {
		fmt.Printf("[TELEGRAM NOTIFICATION] Ticket %s to destination '%s':\n%s\n", m.PublicNumber, m.Destination, telegramText(m))
		return nil
	}
	targetChatID := strings.TrimSpace(m.Destination)
	if targetChatID == "" || targetChatID == "Telegram" || targetChatID == "ID" || strings.HasPrefix(targetChatID, "@") {
		if envChatID := strings.TrimSpace(os.Getenv("TELEGRAM_CHAT_ID")); envChatID != "" {
			targetChatID = envChatID
		}
	}
	if targetChatID == "" || targetChatID == "Telegram" || targetChatID == "ID" || strings.HasPrefix(targetChatID, "@") {
		return PermanentError{fmt.Errorf("telegram destination '%s' is not a numeric chat_id (use Telegram bot link to bind)", m.Destination)}
	}
	body, _ := json.Marshal(map[string]string{"chat_id": targetChatID, "text": telegramText(m)})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/sendMessage", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == 400 || resp.StatusCode == 403 {
		return PermanentError{fmt.Errorf("telegram returned HTTP %d", resp.StatusCode)}
	}
	if resp.StatusCode == 429 || resp.StatusCode >= 500 {
		return fmt.Errorf("telegram returned HTTP %d", resp.StatusCode)
	}
	if resp.StatusCode/100 != 2 {
		return PermanentError{fmt.Errorf("telegram returned HTTP %d", resp.StatusCode)}
	}
	return nil
}
func (s *MultiSender) email(ctx context.Context, m domain.NotificationMessage) error {
	var data struct {
		BranchName  string `json:"branchName"`
		Address     string `json:"address"`
		ServiceName string `json:"serviceName"`
		ScheduledAt string `json:"scheduledAt"`
	}
	_ = json.Unmarshal([]byte(m.Body), &data)
	err := s.mail.SendAppointmentConfirmation(ctx, m.Destination, m.PublicNumber, data.ScheduledAt, data.ServiceName, data.BranchName, data.Address)
	if err == nil {
		return nil
	}
	if err == mailer.ErrNotConfigured {
		return s.demo.Send(ctx, m)
	}
	if strings.Contains(strings.ToLower(err.Error()), "recipient") || strings.Contains(strings.ToLower(err.Error()), "invalid recipient") {
		return PermanentError{err}
	}
	return err
}

func (s *MultiSender) webPush(ctx context.Context, m domain.NotificationMessage) error {
	pub, priv, contact := strings.TrimSpace(os.Getenv("WEB_PUSH_VAPID_PUBLIC_KEY")), strings.TrimSpace(os.Getenv("WEB_PUSH_VAPID_PRIVATE_KEY")), strings.TrimSpace(os.Getenv("WEB_PUSH_CONTACT"))
	if pub == "" || priv == "" || contact == "" {
		return PermanentError{fmt.Errorf("web push provider is not configured")}
	}
	var sub webpush.Subscription
	if err := json.Unmarshal([]byte(m.Destination), &sub); err != nil {
		return PermanentError{fmt.Errorf("invalid web push subscription")}
	}
	title := "Почта России"
	body := text(m)
	if m.EventType == domain.NotificationTicketNearTurn {
		title = "Скоро ваша очередь"
		if m.Body != "" {
			body = strings.ReplaceAll(m.Body, "\n", " ")
		} else {
			body = "Пора заходить в отделение."
		}
	}
	if m.EventType == domain.NotificationTicketCalled {
		title = "Вас вызывают"
		if m.WindowNumber > 0 {
			body = fmt.Sprintf("Талон %s — окно №%d", m.PublicNumber, m.WindowNumber)
		} else {
			body = fmt.Sprintf("Талон %s", m.PublicNumber)
		}
	}
	payload, _ := json.Marshal(map[string]string{"title": title, "body": body, "url": "/"})
	resp, err := webpush.SendNotificationWithContext(ctx, payload, &sub, &webpush.Options{VAPIDPublicKey: pub, VAPIDPrivateKey: priv, Subscriber: contact, TTL: 60})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
		return PermanentError{fmt.Errorf("web push returned HTTP %d", resp.StatusCode)}
	}
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		return fmt.Errorf("web push returned HTTP %d", resp.StatusCode)
	}
	if resp.StatusCode/100 != 2 {
		return PermanentError{fmt.Errorf("web push returned HTTP %d", resp.StatusCode)}
	}
	return nil
}

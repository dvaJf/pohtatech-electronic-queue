package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"postcode/backend/internal/domain"
	"postcode/backend/internal/persistence"
)

type notificationClientUseCases interface {
	ListNotificationSubscriptions(ctx context.Context, ticketID string) ([]domain.NotificationSubscription, error)
	UpsertNotificationSubscription(ctx context.Context, ticketID string, channel domain.NotificationChannel, destination string) (domain.NotificationSubscription, error)
	DisableNotificationSubscription(ctx context.Context, ticketID, channel, subscriptionID string) error
	CreateTelegramLink(ctx context.Context, ticketID string) (string, error)
	ConsumeTelegramLink(ctx context.Context, token, chatID string) (domain.NotificationSubscription, error)
	DisableTelegramForChat(ctx context.Context, chatID string) error
}

func (a *API) notificationStore() (notificationClientUseCases, bool) {
	n, ok := a.usecases.(notificationClientUseCases)
	return n, ok
}

func (a *API) NotificationCapabilities(w http.ResponseWriter, r *http.Request) {
	configured := func(keys ...string) bool {
		for _, key := range keys {
			if strings.TrimSpace(os.Getenv(key)) == "" {
				return false
			}
		}
		return true
	}
	smsReal := configured("ANDROID_SMS_URL") || configured("SMSAERO_EMAIL", "SMSAERO_API_KEY") || configured("SMSRU_API_KEY")
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"telegram": map[string]any{"enabled": configured("TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME"), "mode": "real"},
		"webPush":  map[string]any{"enabled": configured("WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY", "WEB_PUSH_CONTACT"), "mode": "real"},
		"sms":      map[string]any{"enabled": true, "mode": map[bool]string{true: "real", false: "demo"}[smsReal]},
		"email":    map[string]any{"enabled": true, "mode": map[bool]string{true: "smtp", false: "demo"}[configured("SMTP_HOST", "SMTP_PASSWORD") && (configured("SMTP_USERNAME") || configured("SMTP_USER"))]},
	})
}
func notificationContext(r *http.Request) context.Context {
	return persistence.WithManagementToken(persistence.WithPublicClient(r.Context()), r.Header.Get("X-Ticket-Manage-Token"))
}
func (a *API) Notifications(w http.ResponseWriter, r *http.Request) {
	n, ok := a.notificationStore()
	if !ok {
		writeJSONError(w, r, 501, "NOT_CONFIGURED", "Notifications are unavailable")
		return
	}
	s, err := n.ListNotificationSubscriptions(notificationContext(r), chi.URLParam(r, "ticketId"))
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	for i := range s {
		s[i].Destination = maskDestination(s[i].Channel, s[i].Destination)
	}
	writeJSONResponse(w, 200, map[string]any{"items": s})
}
func (a *API) TelegramLink(w http.ResponseWriter, r *http.Request) {
	n, ok := a.notificationStore()
	if !ok {
		writeJSONError(w, r, 501, "NOT_CONFIGURED", "Telegram unavailable")
		return
	}
	username := strings.TrimPrefix(strings.TrimSpace(os.Getenv("TELEGRAM_BOT_USERNAME")), "@")
	if username == "" {
		writeJSONError(w, r, 503, "PROVIDER_UNAVAILABLE", "Telegram temporarily unavailable")
		return
	}
	token, err := n.CreateTelegramLink(notificationContext(r), chi.URLParam(r, "ticketId"))
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	writeJSONResponse(w, 201, map[string]string{"url": "https://t.me/" + username + "?start=" + token})
}
func (a *API) PutNotificationSubscription(w http.ResponseWriter, r *http.Request) {
	n, ok := a.notificationStore()
	if !ok {
		writeJSONError(w, r, 501, "NOT_CONFIGURED", "Notifications unavailable")
		return
	}
	var req struct {
		Destination string `json:"destination"`
	}
	if json.NewDecoder(r.Body).Decode(&req) != nil {
		writeJSONError(w, r, 400, "VALIDATION_ERROR", "Invalid request")
		return
	}
	ch := domain.NotificationChannel(strings.ToUpper(chi.URLParam(r, "channel")))
	if ch != domain.NotificationChannelSMS && ch != domain.NotificationChannelEmail && ch != domain.NotificationChannelWebPush {
		writeJSONError(w, r, 400, "VALIDATION_ERROR", "Unsupported channel")
		return
	}
	s, err := n.UpsertNotificationSubscription(notificationContext(r), chi.URLParam(r, "ticketId"), ch, req.Destination)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	s.Destination = maskDestination(s.Channel, s.Destination)
	writeJSONResponse(w, 200, s)
}
func (a *API) DeleteNotificationSubscription(w http.ResponseWriter, r *http.Request) {
	n, ok := a.notificationStore()
	if !ok {
		writeJSONError(w, r, 501, "NOT_CONFIGURED", "Notifications unavailable")
		return
	}
	err := n.DisableNotificationSubscription(notificationContext(r), chi.URLParam(r, "ticketId"), strings.ToUpper(chi.URLParam(r, "channel")), chi.URLParam(r, "subscriptionId"))
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
func maskDestination(ch domain.NotificationChannel, v string) string {
	if ch == domain.NotificationChannelWebPush {
		return "Подписка браузера"
	}
	if ch == domain.NotificationChannelEmail {
		p := strings.Split(v, "@")
		if len(p) == 2 && p[0] != "" {
			return p[0][:1] + "***@" + p[1]
		}
	}
	if len(v) > 4 {
		return v[:2] + " *** " + v[len(v)-2:]
	}
	return "***"
}

func (a *API) TelegramWebhook(w http.ResponseWriter, r *http.Request) {
	secret := os.Getenv("TELEGRAM_WEBHOOK_SECRET")
	if secret == "" || r.Header.Get("X-Telegram-Bot-Api-Secret-Token") != secret {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	n, ok := a.notificationStore()
	if !ok {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	var update struct {
		Message *struct {
			Text string `json:"text"`
			Chat struct {
				ID json.Number `json:"id"`
			} `json:"chat"`
		} `json:"message"`
	}
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	if dec.Decode(&update) != nil || update.Message == nil {
		w.WriteHeader(http.StatusOK)
		return
	}
	text := strings.TrimSpace(update.Message.Text)
	chatID := update.Message.Chat.ID.String()
	if strings.HasPrefix(text, "/start ") {
		_, _ = n.ConsumeTelegramLink(r.Context(), strings.TrimSpace(strings.TrimPrefix(text, "/start")), chatID)
	} else if strings.HasPrefix(text, "/stop") {
		_ = n.DisableTelegramForChat(r.Context(), chatID)
	}
	w.WriteHeader(http.StatusOK)
}

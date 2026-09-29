package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"postcode/backend/internal/domain"
)

type TelegramLinkConsumer interface {
	ConsumeTelegramLink(ctx context.Context, token, chatID string) (domain.NotificationSubscription, error)
	DisableTelegramForChat(ctx context.Context, chatID string) error
}

type Logger interface {
	Info(msg string, args ...any)
	Warn(msg string, args ...any)
	Error(msg string, args ...any)
}

// StartTelegramPoller runs a background long-polling loop for the Telegram Bot API.
// This enables receiving /start <token> commands from users even on localhost or behind NAT/VPN,
// without requiring a public HTTPS webhook callback.
func StartTelegramPoller(ctx context.Context, store TelegramLinkConsumer, logger Logger) {
	token := strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN"))
	if token == "" {
		return
	}

	go func() {
		client := &http.Client{Timeout: 20 * time.Second}
		offset := 0
		logger.Info("Telegram bot poller started", "bot_username", os.Getenv("TELEGRAM_BOT_USERNAME"))

		for {
			select {
			case <-ctx.Done():
				return
			default:
			}

			reqURL := fmt.Sprintf("https://api.telegram.org/bot%s/getUpdates?offset=%d&timeout=10", token, offset)
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
			if err != nil {
				time.Sleep(2 * time.Second)
				continue
			}

			resp, err := client.Do(req)
			if err != nil {
				time.Sleep(3 * time.Second)
				continue
			}

			var result struct {
				OK     bool `json:"ok"`
				Result []struct {
					UpdateID int `json:"update_id"`
					Message  *struct {
						Text string `json:"text"`
						Chat struct {
							ID json.Number `json:"id"`
						} `json:"chat"`
					} `json:"message"`
				} `json:"result"`
			}

			dec := json.NewDecoder(resp.Body)
			dec.UseNumber()
			err = dec.Decode(&result)
			resp.Body.Close()

			if err != nil || !result.OK {
				time.Sleep(2 * time.Second)
				continue
			}

			for _, upd := range result.Result {
				if upd.UpdateID >= offset {
					offset = upd.UpdateID + 1
				}
				if upd.Message == nil {
					continue
				}

				chatID := upd.Message.Chat.ID.String()
				text := strings.TrimSpace(upd.Message.Text)

				if strings.HasPrefix(text, "/start") {
					parts := strings.Fields(text)
					if len(parts) > 1 {
						linkToken := parts[1]
						sub, err := store.ConsumeTelegramLink(ctx, linkToken, chatID)
						if err == nil {
							logger.Info("Telegram link consumed", "ticket_id", sub.TicketID, "chat_id", chatID)
							sendTelegramBotText(ctx, client, token, chatID, "🔔 Вы успешно подключили уведомления по талону! Мы сообщим вам, когда ваша очередь приблизится и когда вас вызовут к окну.")
							continue
						}
					}
					sendTelegramBotText(ctx, client, token, chatID, "👋 Здравствуйте! Бот электронной очереди Почты России готов к работе. При взятии талона нажмите «Подключить Telegram», чтобы получать уведомления о вызове.")
				} else if strings.HasPrefix(text, "/stop") {
					_ = store.DisableTelegramForChat(ctx, chatID)
					sendTelegramBotText(ctx, client, token, chatID, "🔕 Уведомления для этого чата отключены.")
				}
			}
		}
	}()
}

func sendTelegramBotText(ctx context.Context, client *http.Client, token, chatID, text string) {
	body, _ := json.Marshal(map[string]string{
		"chat_id": chatID,
		"text":    text,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.telegram.org/bot"+token+"/sendMessage", bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return
	}
	_ = resp.Body.Close()
}

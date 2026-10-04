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
	FindActiveTicketByTelegramChat(ctx context.Context, chatID string) (*domain.Ticket, error)
	CancelTicketByTelegram(ctx context.Context, chatID string) (*domain.Ticket, error)
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
							if strings.HasPrefix(sub.ID, "user-link-") {
								sendTelegramBotText(ctx, client, token, chatID, "✅ <b>Аккаунт успешно привязан</b>\n\nТеперь все ваши талоны и предварительные записи будут автоматически присылать уведомления в этот чат.\n\nКоманды:\n/ticket — статус активного талона\n/cancel — отменить активный талон\n/help — помощь")
							} else {
								sendTelegramBotText(ctx, client, token, chatID, "🔔 <b>Уведомления подключены</b>\n\nМы пришлем сообщение, когда ваша очередь приблизится или вас вызовут к окну.\n\n/ticket — проверить статус\n/cancel — отменить талон")
							}
							continue
						}
					}
					sendTelegramBotText(ctx, client, token, chatID, "👋 <b>Цифровая очередь Почты России</b>\n\nЭтот бот оперативно информирует о статусе ваших талонов и записей.\n\nУже есть талон или аккаунт? Нажмите <b>«Подключить Telegram»</b> в веб-приложении для быстрой привязки.\n\nКоманды:\n/ticket — проверить активный талон\n/cancel — отменить текущий талон\n/help — список возможностей")
				} else if strings.HasPrefix(text, "/ticket") {
					ticket, err := store.FindActiveTicketByTelegramChat(ctx, chatID)
					if err != nil || ticket == nil {
						sendTelegramBotText(ctx, client, token, chatID, "ℹ️ <b>У вас нет активных талонов</b>\n\nВы можете взять талон или записаться онлайн на сайте сервиса.")
					} else {
						winStr := ""
						if ticket.Window != nil {
							winStr = fmt.Sprintf("\nОкно: <b>№%d</b>", ticket.Window.Number)
						}
						serviceStr := ""
						if ticket.ServiceName != "" {
							serviceStr = fmt.Sprintf("\nУслуга: <b>%s</b>", ticket.ServiceName)
						}
						sendTelegramBotText(ctx, client, token, chatID, fmt.Sprintf("🎫 <b>Активный талон %s</b>%s\nСтатус: <b>%s</b>%s\n\nДля отмены талона отправьте /cancel", ticket.PublicNumber, serviceStr, ticket.Status.RussianLabel(), winStr))
					}
				} else if strings.HasPrefix(text, "/cancel") {
					cancelled, err := store.CancelTicketByTelegram(ctx, chatID)
					if err != nil || cancelled == nil {
						sendTelegramBotText(ctx, client, token, chatID, "ℹ️ <b>У вас нет активного талона для отмены</b>")
					} else {
						sendTelegramBotText(ctx, client, token, chatID, fmt.Sprintf("❌ Талон <b>%s</b> успешно отменён.", cancelled.PublicNumber))
					}
				} else if strings.HasPrefix(text, "/help") {
					sendTelegramBotText(ctx, client, token, chatID, "ℹ️ <b>Справка бота Почты России</b>\n\n/ticket — проверить статус активного талона\n/cancel — отменить активный талон\n/stop — отключить уведомления для этого чата\n/start — информация о сервисе")
				} else if strings.HasPrefix(text, "/stop") {
					_ = store.DisableTelegramForChat(ctx, chatID)
					sendTelegramBotText(ctx, client, token, chatID, "🔕 <b>Уведомления отключены</b>\n\nДля этого чата уведомления деактивированы. Чтобы включить заново, воспользуйтесь кнопкой «Подключить Telegram» на сайте.")
				}
			}
		}
	}()
}

func sendTelegramBotText(ctx context.Context, client *http.Client, token, chatID, text string) {
	body, _ := json.Marshal(map[string]string{
		"chat_id":    chatID,
		"text":       text,
		"parse_mode": "HTML",
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

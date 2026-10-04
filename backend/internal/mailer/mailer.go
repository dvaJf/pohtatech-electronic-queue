package mailer

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"os"
	"strings"
	"time"
)

type Config struct {
	Host       string
	Port       string
	User       string
	Password   string
	From       string
	AppBaseURL string
}

func ConfigFromEnv() Config {
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	if host == "" {
		host = "smtp.yandex.ru"
	}
	port := strings.TrimSpace(os.Getenv("SMTP_PORT"))
	if port == "" {
		port = "465"
	}
	user := strings.TrimSpace(os.Getenv("SMTP_USER"))
	if user == "" {
		user = strings.TrimSpace(os.Getenv("SMTP_USERNAME"))
	}
	pass := strings.TrimSpace(os.Getenv("SMTP_PASSWORD"))
	from := strings.TrimSpace(os.Getenv("SMTP_FROM"))
	if from == "" {
		if user != "" {
			from = fmt.Sprintf("Почта России <%s>", user)
		} else {
			from = "no-reply@pochta.local"
		}
	}
	appURL := strings.TrimSpace(os.Getenv("SMTP_APP_BASE_URL"))
	if appURL == "" {
		appURL = "https://pointers-team.tech"
	}

	return Config{
		Host:       host,
		Port:       port,
		User:       user,
		Password:   pass,
		From:       from,
		AppBaseURL: strings.TrimRight(appURL, "/"),
	}
}

type Mailer struct {
	cfg Config
}

var ErrNotConfigured = fmt.Errorf("smtp is not configured")

func New(cfg Config) *Mailer {
	return &Mailer{cfg: cfg}
}

// SendAppointmentConfirmation sends a compact multipart confirmation after the
// outbox worker claims an appointment delivery. It never runs in a booking transaction.
func (m *Mailer) SendAppointmentConfirmation(ctx context.Context, to, number, scheduledAt, service, branch, address string) error {
	plain := fmt.Sprintf("Подтверждение записи — Почта России\n\nНомер: %s\nДата и время: %s\nУслуга: %s\nОтделение: %s\nАдрес: %s\n\nПожалуйста, приходите за несколько минут до записи.", number, scheduledAt, service, branch, address)
	html := fmt.Sprintf("<html><body style=\"font-family: sans-serif;\"><h2 style=\"color: #054FA6;\">Запись подтверждена — Почта России</h2><p><b>Номер талона:</b> %s</p><p><b>Дата и время:</b> %s</p><p><b>Услуга:</b> %s</p><p><b>Отделение:</b> %s<br><b>Адрес:</b> %s</p><p>Пожалуйста, приходите за 5-10 минут до назначенного времени.</p></body></html>", number, scheduledAt, service, branch, address)
	subject := fmt.Sprintf("Запись %s подтверждена — Почта России", number)
	return m.sendEmailInternal(to, subject, plain, html)
}

func (m *Mailer) SendAppointmentVerificationEmail(ctx context.Context, toEmail, ticketID, publicNumber, scheduledAt, serviceName, branchName, branchAddress, code, token, customBaseURL string) error {
	toEmail = strings.TrimSpace(strings.ToLower(toEmail))
	if toEmail == "" {
		return fmt.Errorf("recipient email is required")
	}

	baseURL := m.cfg.AppBaseURL
	if customBaseURL != "" {
		baseURL = strings.TrimRight(customBaseURL, "/")
	}

	confirmURL := fmt.Sprintf("%s/api/v1/appointments/%s/confirm?token=%s", baseURL, ticketID, token)

	if m.cfg.User == "" || m.cfg.Password == "" {
		slog.Warn("SMTP not configured, logging appointment confirmation to stdout",
			"to", toEmail, "ticket_id", ticketID, "code", code, "confirm_url", confirmURL)
		return nil
	}

	subject := fmt.Sprintf("Подтверждение записи %s — Почта России", publicNumber)
	plainText := fmt.Sprintf("Здравствуйте!\r\n\r\nПодтвердите предварительную запись в отделение Почты России.\r\nНомер: %s\r\nОтделение: %s (%s)\r\nУслуга: %s\r\nДата и время: %s\r\n\r\nКод подтверждения: %s\r\nИли подтвердите в один клик:\r\n%s\r\n\r\nВнимание: бронь сохраняется 15 минут. Если не подтвердить запись, слот будет освобождён.\r\nАО «Почта России»\r\n", publicNumber, branchName, branchAddress, serviceName, scheduledAt, code, confirmURL)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Подтверждение записи</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    <div style="background: linear-gradient(135deg, #054FA6 0%%, #003274 100%%); padding: 28px 32px; text-align: left;">
      <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">ПОЧТА РОССИИ</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.8); margin-top: 4px; font-weight: 500;">Цифровая очередь нового поколения</div>
    </div>
    <div style="padding: 32px;">
      <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 8px;">Подтверждение предварительной записи</h2>
      <p style="font-size: 14px; color: #64748b; margin-top: 0; margin-bottom: 20px;">
        Талон предварительной записи: <b style="color: #054FA6; font-size: 16px;">%s</b>
      </p>
      <div style="background: #f8fafc; border-radius: 12px; padding: 16px 20px; margin-bottom: 24px; border: 1px solid #e2e8f0;">
        <table style="width: 100%%; border-collapse: collapse; font-size: 14px;">
          <tr><td style="color: #64748b; padding: 6px 0; width: 120px;">Отделение:</td><td style="color: #0f172a; font-weight: 600; padding: 6px 0;">%s</td></tr>
          <tr><td style="color: #64748b; padding: 6px 0;">Адрес:</td><td style="color: #334155; padding: 6px 0;">%s</td></tr>
          <tr><td style="color: #64748b; padding: 6px 0;">Услуга:</td><td style="color: #0f172a; font-weight: 600; padding: 6px 0;">%s</td></tr>
          <tr><td style="color: #64748b; padding: 6px 0;">Время:</td><td style="color: #054FA6; font-weight: 700; padding: 6px 0;">%s</td></tr>
        </table>
      </div>
      <div style="background: #eff6ff; border: 2px dashed #054FA6; border-radius: 12px; padding: 20px 24px; text-align: center; margin: 24px 0;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #054FA6; letter-spacing: 1px; margin-bottom: 6px;">Код подтверждения</div>
        <div style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #054FA6; font-family: 'SF Mono', Consolas, Monaco, monospace;">%s</div>
        <div style="font-size: 12px; color: #dc2626; margin-top: 6px; font-weight: 600;">⏱ Действует 15 минут. Если не подтвердить, слот освободится.</div>
      </div>
      <div style="text-align: center; margin: 28px 0 20px 0;">
        <a href="%s" style="display: inline-block; background: #054FA6; color: #ffffff; text-decoration: none; padding: 14px 28px; font-size: 15px; font-weight: 700; border-radius: 10px; box-shadow: 0 4px 12px rgba(5,79,166,0.25);">Подтвердить запись в один клик &rarr;</a>
      </div>
      <p style="font-size: 12px; line-height: 1.5; color: #94a3b8; text-align: center; margin: 24px 0 0 0;">Если вы не записывались на прием, просто проигнорируйте это письмо.</p>
    </div>
    <div style="background: #f8fafc; border-top: 1px solid #f1f5f9; padding: 16px 32px; text-align: center; font-size: 12px; color: #94a3b8;">
      АО «Почта России» • Интеллектуальное управление клиентскими потоками
    </div>
  </div>
</body>
</html>`, publicNumber, branchName, branchAddress, serviceName, scheduledAt, code, confirmURL)

	return m.sendEmailInternal(toEmail, subject, plainText, htmlBody)
}

func (m *Mailer) SendConfirmationEmail(ctx context.Context, toEmail, code, token, customBaseURL string) error {
	toEmail = strings.TrimSpace(strings.ToLower(toEmail))
	if toEmail == "" {
		return fmt.Errorf("recipient email is required")
	}

	baseURL := m.cfg.AppBaseURL
	if customBaseURL != "" {
		baseURL = strings.TrimRight(customBaseURL, "/")
	}

	confirmURL := fmt.Sprintf("%s/api/v1/auth/confirm?token=%s", baseURL, token)

	if m.cfg.User == "" || m.cfg.Password == "" {
		slog.Warn("SMTP not configured, logging confirmation code to stdout",
			"to", toEmail, "code", code, "confirm_url", confirmURL)
		return nil
	}

	subject := fmt.Sprintf("Код подтверждения: %s — Почта России", code)
	plainText := fmt.Sprintf("Здравствуйте!\r\n\r\nВаш код подтверждения для входа в Цифровую очередь Почты России: %s\r\n\r\nИли перейдите по ссылке для подтверждения:\r\n%s\r\n\r\nКод действителен 15 минут.\r\nАО «Почта России»\r\n\r\n", code, confirmURL)

	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Код подтверждения регистрации</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <div style="max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    <div style="background: linear-gradient(135deg, #054FA6 0%%, #003274 100%%); padding: 28px 32px; text-align: left;">
      <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">ПОЧТА РОССИИ</div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.8); margin-top: 4px; font-weight: 500;">Цифровая очередь нового поколения</div>
    </div>
    <div style="padding: 32px;">
      <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px;">Подтверждение регистрации</h2>
      <p style="font-size: 15px; line-height: 1.5; color: #475569; margin: 0 0 20px 0;">Вы регистрируетесь в сервисе цифровой очереди. Для подтверждения вашего email-адреса используйте 6-значный код:</p>
      <div style="background: #f8fafc; border: 2px dashed #054FA6; border-radius: 12px; padding: 18px 24px; text-align: center; margin: 24px 0;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 1px; margin-bottom: 6px;">Одноразовый код</div>
        <div style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #054FA6; font-family: 'SF Mono', Consolas, Monaco, monospace;">%s</div>
        <div style="font-size: 12px; color: #94a3b8; margin-top: 6px;">Действует в течение 15 минут</div>
      </div>
      <div style="text-align: center; margin: 28px 0 20px 0;">
        <a href="%s" style="display: inline-block; background: #054FA6; color: #ffffff; text-decoration: none; padding: 14px 28px; font-size: 15px; font-weight: 700; border-radius: 10px; box-shadow: 0 4px 12px rgba(5,79,166,0.25);">Подтвердить в один клик &rarr;</a>
      </div>
      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; text-align: center; margin: 24px 0 0 0;">Если вы не совершали регистрацию, просто проигнорируйте это письмо.</p>
    </div>
    <div style="background: #f8fafc; border-top: 1px solid #f1f5f9; padding: 16px 32px; text-align: center; font-size: 12px; color: #94a3b8;">
      АО «Почта России» • Интеллектуальное управление клиентскими потоками
    </div>
  </div>
</body>
</html>`, code, confirmURL)

	return m.sendEmailInternal(toEmail, subject, plainText, htmlBody)
}

func (m *Mailer) sendEmailInternal(toEmail, subject, plainText, htmlBody string) error {
	toEmail = strings.TrimSpace(strings.ToLower(toEmail))
	if toEmail == "" || !strings.Contains(toEmail, "@") {
		return fmt.Errorf("invalid recipient email: %s", toEmail)
	}

	if m.cfg.User == "" || m.cfg.Password == "" || m.cfg.Host == "" {
		slog.Warn("SMTP not configured, skipping delivery", "to", toEmail, "subject", subject)
		return nil
	}

	encodedSubject := fmt.Sprintf("=?UTF-8?B?%s?=", base64.StdEncoding.EncodeToString([]byte(subject)))

	fromName := "Почта России"
	fromEmail := m.cfg.User
	if m.cfg.From != "" {
		if idx := strings.Index(m.cfg.From, "<"); idx != -1 {
			namePart := strings.Trim(m.cfg.From[:idx], " \t\"'")
			if namePart != "" {
				fromName = namePart
			}
			endIdx := strings.Index(m.cfg.From, ">")
			if endIdx > idx {
				fromEmail = strings.TrimSpace(m.cfg.From[idx+1 : endIdx])
			}
		} else if strings.Contains(m.cfg.From, "@") {
			fromEmail = strings.TrimSpace(m.cfg.From)
		} else {
			fromName = strings.TrimSpace(m.cfg.From)
		}
	}
	fromHeader := fmt.Sprintf("=?UTF-8?B?%s?= <%s>", base64.StdEncoding.EncodeToString([]byte(fromName)), fromEmail)

	msgHost := m.cfg.Host
	if strings.Contains(fromEmail, "@") {
		msgHost = strings.Split(fromEmail, "@")[1]
	}
	msgID := fmt.Sprintf("<%d.%d@%s>", time.Now().UnixNano(), time.Now().Unix(), msgHost)
	dateHeader := time.Now().Format(time.RFC1123Z)

	boundary := fmt.Sprintf("===POCHTA_RUSSIA_%d===", time.Now().UnixNano())

	var msgBuilder strings.Builder
	msgBuilder.WriteString(fmt.Sprintf("From: %s\r\n", fromHeader))
	msgBuilder.WriteString(fmt.Sprintf("To: %s\r\n", toEmail))
	msgBuilder.WriteString(fmt.Sprintf("Subject: %s\r\n", encodedSubject))
	msgBuilder.WriteString(fmt.Sprintf("Date: %s\r\n", dateHeader))
	msgBuilder.WriteString(fmt.Sprintf("Message-ID: %s\r\n", msgID))
	msgBuilder.WriteString("MIME-Version: 1.0\r\n")
	msgBuilder.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n\r\n", boundary))

	// Plain text
	msgBuilder.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	msgBuilder.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	msgBuilder.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	msgBuilder.WriteString(base64.StdEncoding.EncodeToString([]byte(plainText)))
	msgBuilder.WriteString("\r\n\r\n")

	// HTML
	msgBuilder.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	msgBuilder.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	msgBuilder.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	msgBuilder.WriteString(base64.StdEncoding.EncodeToString([]byte(htmlBody)))
	msgBuilder.WriteString(fmt.Sprintf("\r\n\r\n--%s--\r\n", boundary))

	rawMessage := []byte(msgBuilder.String())
	addr := net.JoinHostPort(m.cfg.Host, m.cfg.Port)
	auth := smtp.PlainAuth("", m.cfg.User, m.cfg.Password, m.cfg.Host)

	if m.cfg.Port == "465" {
		dialer := &net.Dialer{Timeout: 10 * time.Second}
		tlsConfig := &tls.Config{
			ServerName: m.cfg.Host,
		}
		conn, err := tls.DialWithDialer(dialer, "tcp", addr, tlsConfig)
		if err != nil {
			return fmt.Errorf("tls dial %s: %w", addr, err)
		}
		defer conn.Close()

		client, err := smtp.NewClient(conn, m.cfg.Host)
		if err != nil {
			return fmt.Errorf("smtp new client: %w", err)
		}
		defer client.Quit()

		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth failed: %w", err)
		}
		if err := client.Mail(m.cfg.User); err != nil {
			return fmt.Errorf("smtp mail from: %w", err)
		}
		if err := client.Rcpt(toEmail); err != nil {
			return fmt.Errorf("smtp rcpt to: %w", err)
		}
		w, err := client.Data()
		if err != nil {
			return fmt.Errorf("smtp data: %w", err)
		}
		if _, err := w.Write(rawMessage); err != nil {
			return fmt.Errorf("smtp write body: %w", err)
		}
		if err := w.Close(); err != nil {
			return fmt.Errorf("smtp close data: %w", err)
		}

		slog.Info("Email sent via TLS 465", "to", toEmail, "subject", subject)
		return nil
	}

	err := smtp.SendMail(addr, auth, m.cfg.User, []string{toEmail}, rawMessage)
	if err != nil {
		return fmt.Errorf("smtp sendmail %s: %w", addr, err)
	}

	slog.Info("Email sent", "to", toEmail, "subject", subject)
	return nil
}

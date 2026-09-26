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

func New(cfg Config) *Mailer {
	return &Mailer{cfg: cfg}
}

func (m *Mailer) SendConfirmationEmail(ctx context.Context, toEmail, code, token string) error {
	toEmail = strings.TrimSpace(strings.ToLower(toEmail))
	if toEmail == "" {
		return fmt.Errorf("recipient email is required")
	}

	confirmURL := fmt.Sprintf("%s/api/v1/auth/confirm?token=%s", m.cfg.AppBaseURL, token)

	// Если SMTP не сконфигурирован — пишем в лог (mock/dev режим)
	if m.cfg.User == "" || m.cfg.Password == "" {
		slog.Warn("SMTP not configured, logging confirmation code to stdout",
			"to", toEmail, "code", code, "confirm_url", confirmURL)
		return nil
	}

	subject := fmt.Sprintf("Код подтверждения: %s — Почта России", code)
	encodedSubject := fmt.Sprintf("=?UTF-8?B?%s?=", base64.StdEncoding.EncodeToString([]byte(subject)))

	fromHeader := m.cfg.From
	if !strings.Contains(fromHeader, "<") {
		fromHeader = fmt.Sprintf("=?UTF-8?B?%s?= <%s>", base64.StdEncoding.EncodeToString([]byte(fromHeader)), m.cfg.User)
	}

	boundary := "===POCHTA_RUSSIA_MIME_BOUNDARY==="
	header := make(map[string]string)
	header["From"] = fromHeader
	header["To"] = toEmail
	header["Subject"] = encodedSubject
	header["MIME-Version"] = "1.0"
	header["Content-Type"] = fmt.Sprintf("multipart/alternative; boundary=\"%s\"", boundary)

	var msgBuilder strings.Builder
	for k, v := range header {
		msgBuilder.WriteString(fmt.Sprintf("%s: %s\r\n", k, v))
	}
	msgBuilder.WriteString("\r\n")

	// Plain text часть
	msgBuilder.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	msgBuilder.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
	msgBuilder.WriteString(fmt.Sprintf("Здравствуйте!\r\n\r\nВаш код подтверждения для входа в Цифровую очередь Почты России: %s\r\n\r\nИли перейдите по ссылке для подтверждения:\r\n%s\r\n\r\nКод действителен 15 минут.\r\nАО «Почта России»\r\n\r\n", code, confirmURL))

	// HTML часть с фирменной стилизацией Почты России
	htmlBody := fmt.Sprintf(`<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>Код подтверждения регистрации</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f4f6f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <div style="max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    
    <!-- Шапка Почты России -->
    <div style="background: linear-gradient(135deg, #054FA6 0%%, #003274 100%%); padding: 28px 32px; text-align: left;">
      <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">
        ПОЧТА РОССИИ
      </div>
      <div style="font-size: 13px; color: rgba(255,255,255,0.8); margin-top: 4px; font-weight: 500;">
        Цифровая очередь нового поколения
      </div>
    </div>

    <!-- Основной контент -->
    <div style="padding: 32px;">
      <h2 style="font-size: 20px; font-weight: 700; color: #0f172a; margin-top: 0; margin-bottom: 12px;">
        Подтверждение регистрации
      </h2>
      <p style="font-size: 15px; line-height: 1.5; color: #475569; margin: 0 0 20px 0;">
        Вы регистрируетесь в сервисе цифровой очереди. Для подтверждения вашего email-адреса используйте 6-значный код:
      </p>

      <!-- Блок с кодом -->
      <div style="background: #f8fafc; border: 2px dashed #054FA6; border-radius: 12px; padding: 18px 24px; text-align: center; margin: 24px 0;">
        <div style="font-size: 12px; font-weight: 600; text-transform: uppercase; color: #64748b; letter-spacing: 1px; margin-bottom: 6px;">
          Одноразовый код
        </div>
        <div style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #054FA6; font-family: 'SF Mono', Consolas, Monaco, monospace;">
          %s
        </div>
        <div style="font-size: 12px; color: #94a3b8; margin-top: 6px;">
          Действует в течение 15 минут
        </div>
      </div>

      <!-- Кнопка подтверждения в один клик -->
      <div style="text-align: center; margin: 28px 0 20px 0;">
        <a href="%s" style="display: inline-block; background: #054FA6; color: #ffffff; text-decoration: none; padding: 14px 28px; font-size: 15px; font-weight: 700; border-radius: 10px; box-shadow: 0 4px 12px rgba(5,79,166,0.25);">
          Подтвердить в один клик &rarr;
        </a>
      </div>

      <p style="font-size: 13px; line-height: 1.5; color: #94a3b8; text-align: center; margin: 24px 0 0 0;">
        Если вы не совершали регистрацию, просто проигнорируйте это письмо.
      </p>
    </div>

    <!-- Футер -->
    <div style="background: #f8fafc; border-top: 1px solid #f1f5f9; padding: 16px 32px; text-align: center; font-size: 12px; color: #94a3b8;">
      АО «Почта России» • Интеллектуальное управление клиентскими потоками
    </div>
  </div>
</body>
</html>`, code, confirmURL)

	msgBuilder.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	msgBuilder.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
	msgBuilder.WriteString(htmlBody)
	msgBuilder.WriteString(fmt.Sprintf("\r\n--%s--\r\n", boundary))

	rawMessage := []byte(msgBuilder.String())

	// Отправка через SMTP
	addr := net.JoinHostPort(m.cfg.Host, m.cfg.Port)
	auth := smtp.PlainAuth("", m.cfg.User, m.cfg.Password, m.cfg.Host)

	// Если порт 465 — используем SSL/TLS
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

		slog.Info("Confirmation email sent via TLS", "to", toEmail)
		return nil
	}

	// Иначе порт 587 / стандартный SendMail (с STARTTLS)
	err := smtp.SendMail(addr, auth, m.cfg.User, []string{toEmail}, rawMessage)
	if err != nil {
		return fmt.Errorf("smtp sendmail %s: %w", addr, err)
	}

	slog.Info("Confirmation email sent", "to", toEmail)
	return nil
}

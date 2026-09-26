package sms

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

type Provider interface {
	Send(ctx context.Context, phone, message string) error
}

type Client struct {
	httpClient *http.Client
	aeroEmail  string
	aeroKey    string
	aeroSign   string
	smsRuKey   string
	logger     *slog.Logger
}

func NewClient(logger *slog.Logger) *Client {
	if logger == nil {
		logger = slog.Default()
	}
	email := strings.TrimSpace(os.Getenv("SMSAERO_EMAIL"))
	key := strings.TrimSpace(os.Getenv("SMSAERO_API_KEY"))
	sign := strings.TrimSpace(os.Getenv("SMSAERO_SIGN"))
	if sign == "" {
		sign = "SMS Aero"
	}
	smsRuKey := strings.TrimSpace(os.Getenv("SMSRU_API_KEY"))

	return &Client{
		httpClient: &http.Client{Timeout: 10 * time.Second},
		aeroEmail:  email,
		aeroKey:    key,
		aeroSign:   sign,
		smsRuKey:   smsRuKey,
		logger:     logger,
	}
}

// NormalizePhone converts phone formats (+7 (999) 123-45-67, 8999..., 7999...) to 79991234567.
func NormalizePhone(raw string) (string, error) {
	re := regexp.MustCompile(`\D`)
	digits := re.ReplaceAllString(raw, "")
	if len(digits) == 11 {
		if strings.HasPrefix(digits, "8") {
			digits = "7" + digits[1:]
		}
	} else if len(digits) == 10 && strings.HasPrefix(digits, "9") {
		digits = "7" + digits
	}

	if len(digits) != 11 || !strings.HasPrefix(digits, "7") {
		return "", fmt.Errorf("invalid Russian phone number: expected 11 digits starting with +7 or 8")
	}
	return digits, nil
}

// Send dispatches an SMS via SMS Aero if configured, then SMS.ru, or fallback to mock log.
func (c *Client) Send(ctx context.Context, phone, message string) error {
	normalized, err := NormalizePhone(phone)
	if err != nil {
		return err
	}

	// 1. Try SMS Aero if credentials exist
	if c.aeroEmail != "" && c.aeroKey != "" {
		err := c.sendSMSAero(ctx, normalized, message)
		if err == nil {
			c.logger.Info("SMS delivered via SMS Aero", "phone", normalized)
			return nil
		}
		c.logger.Warn("SMS Aero send failed, trying fallback", "error", err)
	}

	// 2. Try SMS.ru if configured
	if c.smsRuKey != "" {
		err := c.sendSMSRu(ctx, normalized, message)
		if err == nil {
			c.logger.Info("SMS delivered via SMS.ru", "phone", normalized)
			return nil
		}
		c.logger.Warn("SMS.ru send failed", "error", err)
	}

	// 3. Fallback / Dev Mock
	c.logger.Info("[DEV/DEMO SMS]", "to", normalized, "message", message)
	return nil
}

type aeroResponse struct {
	Success bool            `json:"success"`
	Data    json.RawMessage `json:"data"`
	Message string          `json:"message"`
}

func (c *Client) sendSMSAero(ctx context.Context, phone, message string) error {
	endpoint := "https://gate.smsaero.ru/v2/sms/send"
	q := url.Values{}
	q.Set("number", phone)
	q.Set("text", message)
	q.Set("sign", c.aeroSign)

	reqURL := endpoint + "?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return err
	}
	req.SetBasicAuth(c.aeroEmail, c.aeroKey)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request to smsaero failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("smsaero returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var res aeroResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return fmt.Errorf("smsaero json unmarshal: %w, raw: %s", err, string(body))
	}
	if !res.Success {
		return fmt.Errorf("smsaero error: %s", res.Message)
	}
	return nil
}

type smsRuResponse struct {
	Status     string `json:"status"`
	StatusCode int    `json:"status_code"`
	StatusText string `json:"status_text"`
}

func (c *Client) sendSMSRu(ctx context.Context, phone, message string) error {
	endpoint := "https://sms.ru/sms/send"
	q := url.Values{}
	q.Set("api_id", c.smsRuKey)
	q.Set("to", phone)
	q.Set("msg", message)
	q.Set("json", "1")

	reqURL := endpoint + "?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request to sms.ru failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var res smsRuResponse
	if err := json.Unmarshal(body, &res); err != nil {
		return fmt.Errorf("sms.ru json unmarshal: %w", err)
	}
	if res.Status != "OK" {
		return fmt.Errorf("sms.ru error: [%d] %s", res.StatusCode, res.StatusText)
	}
	return nil
}

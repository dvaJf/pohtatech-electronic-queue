package config

import (
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppEnv                    string
	LogLevel                  slog.Level
	HTTPPort                  string
	DatabaseURL               string
	AllowedOrigin             string
	NotificationProviderURL   string
	NotificationTimeout       time.Duration
	NotificationRetryInterval time.Duration
	NotificationMaxAttempts   int
}

func loadDotEnv() {
	paths := []string{".env", "../.env"}
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		for _, line := range lines {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				k := strings.TrimSpace(parts[0])
				v := strings.TrimSpace(parts[1])
				v = strings.Trim(v, `"'`)
				if os.Getenv(k) == "" {
					_ = os.Setenv(k, v)
				}
			}
		}
	}
}

func Load() (Config, error) {
	loadDotEnv()
	var c Config
	required := []string{"APP_ENV", "LOG_LEVEL", "HTTP_PORT", "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "CORS_ALLOWED_ORIGIN"}
	for _, key := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			return c, fmt.Errorf("%s is required", key)
		}
	}
	c.AppEnv = os.Getenv("APP_ENV")
	if err := c.LogLevel.UnmarshalText([]byte(os.Getenv("LOG_LEVEL"))); err != nil {
		return c, fmt.Errorf("LOG_LEVEL must be DEBUG, INFO, WARN or ERROR")
	}
	for _, key := range []string{"HTTP_PORT", "POSTGRES_PORT"} {
		p, err := strconv.Atoi(os.Getenv(key))
		if err != nil || p < 1 || p > 65535 {
			return c, fmt.Errorf("%s must be a port between 1 and 65535", key)
		}
	}
	c.HTTPPort = os.Getenv("HTTP_PORT")
	c.AllowedOrigin = os.Getenv("CORS_ALLOWED_ORIGIN")
	origins := strings.Split(c.AllowedOrigin, ",")
	for _, raw := range origins {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		origin, err := url.Parse(raw)
		if err != nil || (origin.Scheme != "http" && origin.Scheme != "https") || origin.Host == "" || strings.Contains(origin.Host, "*") || origin.User != nil || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" {
			return c, fmt.Errorf("CORS_ALLOWED_ORIGIN must be one or more http(s) origins without a path")
		}
	}
	pgHost := os.Getenv("POSTGRES_HOST")
	if pgHost == "postgres" {
		if _, err := net.LookupHost("postgres"); err != nil {
			pgHost = "localhost"
		}
	}
	dsn := url.URL{Scheme: "postgres", User: url.UserPassword(os.Getenv("POSTGRES_USER"), os.Getenv("POSTGRES_PASSWORD")), Host: net.JoinHostPort(pgHost, os.Getenv("POSTGRES_PORT")), Path: "/" + os.Getenv("POSTGRES_DB")}
	// The Foundation Compose network is local development only.
	dsn.RawQuery = "sslmode=disable&connect_timeout=3"
	c.DatabaseURL = dsn.String()

	c.NotificationProviderURL = strings.TrimSpace(os.Getenv("NOTIFICATION_PROVIDER_URL"))
	timeoutSec := 2
	if tStr := os.Getenv("NOTIFICATION_TIMEOUT_SECONDS"); tStr != "" {
		if tVal, err := strconv.Atoi(tStr); err == nil && tVal > 0 {
			timeoutSec = tVal
		}
	}
	c.NotificationTimeout = time.Duration(timeoutSec) * time.Second

	retryMs := 1000
	if rStr := os.Getenv("NOTIFICATION_RETRY_INTERVAL_MS"); rStr != "" {
		if rVal, err := strconv.Atoi(rStr); err == nil && rVal > 0 {
			retryMs = rVal
		}
	}
	c.NotificationRetryInterval = time.Duration(retryMs) * time.Millisecond

	maxAttempts := 3
	if mStr := os.Getenv("NOTIFICATION_MAX_ATTEMPTS"); mStr != "" {
		if mVal, err := strconv.Atoi(mStr); err == nil && mVal > 0 {
			maxAttempts = mVal
		}
	}
	c.NotificationMaxAttempts = maxAttempts

	return c, nil
}

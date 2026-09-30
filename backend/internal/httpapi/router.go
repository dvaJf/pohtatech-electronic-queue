package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"postcode/backend/internal/application"
)

// Pinger is the small boundary needed to test readiness without PostgreSQL.
type Pinger interface{ Ping(context.Context) error }

func stripDuplicateAPIPrefix(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		for len(path) >= 8 && path[:8] == "/api/api" {
			path = path[4:]
		}
		if path != r.URL.Path {
			r.URL.Path = path
		}
		next.ServeHTTP(w, r)
	})
}

func NewRouter(db Pinger, usecases application.UseCases, logger *slog.Logger, origin string) http.Handler {
	r := chi.NewRouter()
	r.Use(stripDuplicateAPIPrefix)
	r.Use(requestLog(logger), recoverPanic(logger), cors(origin), metricsMiddleware())
	r.Handle("/metrics", promhttp.Handler())

	healthHandler := func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	}
	readyHandler := func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := db.Ping(ctx); err != nil {
			// Driver errors can contain connection details. Log a safe diagnostic instead.
			logger.ErrorContext(ctx, "PostgreSQL readiness check failed", "component", "database", "request_id", requestID(r), "error", "database unavailable or ping timed out")
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready", "database": "unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "database": "ok"})
	}

	r.Get("/health", healthHandler)
	r.Get("/ready", readyHandler)
	r.Get("/api/health", healthHandler)
	r.Get("/api/ready", readyHandler)
	r.Get("/api/v1/health", healthHandler)
	r.Get("/api/v1/ready", readyHandler)

	api := NewAPI(usecases)
	api.RegisterRoutes(r)
	r.Post("/api/integrations/telegram/webhook", api.TelegramWebhook)
	r.Post("/api/v1/integrations/telegram/webhook", api.TelegramWebhook)
	r.Post("/api/integrations/alice/webhook", api.AliceWebhook)
	r.Post("/api/v1/integrations/alice/webhook", api.AliceWebhook)

	return r
}

func writeJSON(w http.ResponseWriter, status int, body map[string]string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

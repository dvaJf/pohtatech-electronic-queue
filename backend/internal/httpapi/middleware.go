package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"postcode/backend/internal/domain"
)

type requestIDKey struct{}
type userContextKey struct{}

func requestID(r *http.Request) string {
	id, _ := r.Context().Value(requestIDKey{}).(string)
	return id
}

func userFromContext(ctx context.Context) (domain.User, bool) {
	u, ok := ctx.Value(userContextKey{}).(domain.User)
	return u, ok
}

func requestLog(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Generate our own bounded ID; do not trust arbitrary caller-supplied log content.
			var bytes [16]byte
			_, _ = rand.Read(bytes[:])
			id := hex.EncodeToString(bytes[:])
			r = r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id))
			w.Header().Set("X-Request-ID", id)
			wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			defer func() {
				status := wrapped.Status()
				if status == 0 {
					status = http.StatusOK
				}
				logger.InfoContext(r.Context(), "HTTP request", "component", "http", "request_id", id, "method", r.Method, "path", r.URL.Path, "status", status, "duration", time.Since(start).String())
			}()
			next.ServeHTTP(wrapped, r)
		})
	}
}

func recoverPanic(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if recover() != nil {
					logger.ErrorContext(r.Context(), "HTTP handler panic", "component", "http", "request_id", requestID(r))
					writeJSONError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "Internal server error")
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

func cors(allowedOrigin string) func(http.Handler) http.Handler {
	origins := strings.Split(allowedOrigin, ",")
	allowedMap := make(map[string]bool)
	for _, o := range origins {
		trimmed := strings.TrimSpace(o)
		if trimmed != "" {
			allowedMap[trimmed] = true
		}
	}
	// Explicitly trust known exact origins
	trustedExact := []string{
		"http://localhost:5173",
		"http://127.0.0.1:5173",
		"http://localhost:8080",
		"http://127.0.0.1:8080",
		"http://localhost:3000",
		"http://127.0.0.1:3000",
		"https://pointers-team.tech",
		"https://www.pointers-team.tech",
		"https://post-queue.duckdns.org",
		"http://144.31.181.192",
		"https://144.31.181.192",
	}
	for _, t := range trustedExact {
		allowedMap[t] = true
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			reqOrigin := r.Header.Get("Origin")
			if reqOrigin != "" {
				w.Header().Add("Vary", "Origin")
				matched := allowedMap["*"] || allowedMap[reqOrigin]
				if matched {
					w.Header().Set("Access-Control-Allow-Origin", reqOrigin)
					w.Header().Set("Access-Control-Allow-Credentials", "true")
					w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
					if r.Method == http.MethodOptions {
						w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
						w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Idempotency-Key, X-Request-ID, Authorization")
						w.WriteHeader(http.StatusNoContent)
						return
					}
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// loadSession reads the session cookie, validates it, and stores the user in context.
// If no valid session is found the request continues without a user (unauthenticated).
func (a *API) loadSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(sessionCookie)
		if err == nil && cookie.Value != "" {
			u, err := a.usecases.GetSessionUser(r.Context(), cookie.Value)
			if err == nil {
				r = r.WithContext(context.WithValue(r.Context(), userContextKey{}, u))
			}
		}
		next.ServeHTTP(w, r)
	})
}

// requireRole returns 401 if not authenticated, 403 if role is not in the allowed list.
func requireRole(roles ...domain.UserRole) func(http.Handler) http.Handler {
	allowed := make(map[domain.UserRole]bool, len(roles))
	for _, r := range roles {
		allowed[r] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := userFromContext(r.Context())
			if !ok {
				writeJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Login required")
				return
			}
			if !allowed[u.Role] {
				writeJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "Insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// requireTerminal returns 403 if user does not have the is_terminal flag set.
func requireTerminal(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromContext(r.Context())
		if !ok {
			writeJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Login required")
			return
		}
		if !u.IsTerminal {
			writeJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "Terminal access only")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireAuth returns 401 if the request has no valid session (any role accepted).
func requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, ok := userFromContext(r.Context())
		if !ok {
			writeJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "Login required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

var (
	reqTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "http_requests_total",
		Help: "Total number of HTTP requests processed",
	}, []string{"method", "path", "status"})

	reqDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "http_request_duration_seconds",
		Help:    "HTTP request latency in seconds",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path"})
)

func metricsMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}
			start := time.Now()
			wrapped, ok := w.(middleware.WrapResponseWriter)
			if !ok {
				wrapped = middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			}
			defer func() {
				path := r.URL.Path
				if rctx := chi.RouteContext(r.Context()); rctx != nil {
					if pattern := rctx.RoutePattern(); pattern != "" {
						path = pattern
					}
				}
				status := wrapped.Status()
				if status == 0 {
					status = http.StatusOK
				}
				reqTotal.WithLabelValues(r.Method, path, strconv.Itoa(status)).Inc()
				reqDuration.WithLabelValues(r.Method, path).Observe(time.Since(start).Seconds())
			}()
			next.ServeHTTP(wrapped, r)
		})
	}
}

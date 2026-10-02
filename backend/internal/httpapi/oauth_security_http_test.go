package httpapi

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"postcode/backend/internal/domain"
)

func TestOAuthSecurity(t *testing.T) {
	uc := &FakeUseCases{
		LoginOAuthFunc: func(ctx context.Context, email string) (domain.Session, error) {
			return domain.Session{
				Token:     "test-oauth-session-token",
				UserID:    "u-oauth-1",
				ExpiresAt: time.Now().Add(24 * time.Hour),
			}, nil
		},
	}
	db := &fakeDB{}
	logger := slog.New(slog.NewJSONHandler(bytes.NewBuffer(nil), nil))
	router := NewRouter(db, uc, logger, "http://localhost:3000")

	t.Run("Demo param ignored when ALLOW_DEMO_OAUTH is not set", func(t *testing.T) {
		t.Setenv("ALLOW_DEMO_OAUTH", "")
		t.Setenv("APP_ENV", "production")
		t.Setenv("YANDEX_CLIENT_ID", "")

		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/yandex/login?demo=1", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusTemporaryRedirect {
			t.Fatalf("expected 307 redirect, got %d", w.Code)
		}
		loc := w.Header().Get("Location")
		if !strings.Contains(loc, "auth_error=oauth_unconfigured") {
			t.Fatalf("expected redirect with auth_error=oauth_unconfigured, got: %s", loc)
		}
	})

	t.Run("OAuthLogin generates state cookie and includes state in auth URL", func(t *testing.T) {
		t.Setenv("YANDEX_CLIENT_ID", "test-client-id-123")
		t.Setenv("ALLOW_DEMO_OAUTH", "")

		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/yandex/login", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusTemporaryRedirect {
			t.Fatalf("expected 307 redirect, got %d", w.Code)
		}

		var stateCookie *http.Cookie
		for _, c := range w.Result().Cookies() {
			if c.Name == "oauth_state" {
				stateCookie = c
				break
			}
		}
		if stateCookie == nil || stateCookie.Value == "" {
			t.Fatalf("expected oauth_state cookie to be set")
		}
		if !stateCookie.HttpOnly {
			t.Errorf("expected oauth_state cookie to be HttpOnly")
		}

		loc := w.Header().Get("Location")
		u, err := url.Parse(loc)
		if err != nil {
			t.Fatalf("failed to parse redirect url: %v", err)
		}
		q := u.Query()
		if q.Get("state") != stateCookie.Value {
			t.Fatalf("expected state param %q in redirect URL, got %q", stateCookie.Value, q.Get("state"))
		}
		if q.Get("client_id") != "test-client-id-123" {
			t.Fatalf("expected client_id test-client-id-123, got %q", q.Get("client_id"))
		}
	})

	t.Run("OAuthCallback rejects request without state parameter", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/yandex/callback?code=mock-code", nil)
		req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "expected-secret-state"})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusTemporaryRedirect {
			t.Fatalf("expected 307 redirect, got %d", w.Code)
		}
		loc := w.Header().Get("Location")
		if !strings.Contains(loc, "auth_error=invalid_state") {
			t.Fatalf("expected redirect to auth_error=invalid_state, got: %s", loc)
		}
	})

	t.Run("OAuthCallback rejects request with mismatching state", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/oauth/yandex/callback?code=mock-code&state=forged-state", nil)
		req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "legit-state"})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusTemporaryRedirect {
			t.Fatalf("expected 307 redirect, got %d", w.Code)
		}
		loc := w.Header().Get("Location")
		if !strings.Contains(loc, "auth_error=invalid_state") {
			t.Fatalf("expected redirect to auth_error=invalid_state, got: %s", loc)
		}
	})
}

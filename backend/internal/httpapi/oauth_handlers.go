package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/auth/oauth/{provider}/login
// ─────────────────────────────────────────────────────────────────────────────

func (a *API) OAuthLogin(w http.ResponseWriter, r *http.Request) {
	provider := strings.ToLower(chi.URLParam(r, "provider"))
	isDemo := r.URL.Query().Get("demo") == "1"

	redirectURI := getOAuthRedirectURI(r, provider)

	switch provider {
	case "yandex":
		clientID := strings.TrimSpace(os.Getenv("YANDEX_CLIENT_ID"))
		if clientID == "" || isDemo {
			// Демо / мгновенный режим без задержек и модерации
			a.completeOAuthSession(w, r, "client.yandex@yandex.ru", "yandex")
			return
		}
		authURL := fmt.Sprintf("https://oauth.yandex.ru/authorize?response_type=code&client_id=%s&redirect_uri=%s",
			url.QueryEscape(clientID), url.QueryEscape(redirectURI))
		http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)

	default:
		writeJSONError(w, r, http.StatusBadRequest, "UNSUPPORTED_PROVIDER", "supported provider is yandex")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/auth/oauth/{provider}/callback
// ─────────────────────────────────────────────────────────────────────────────

func (a *API) OAuthCallback(w http.ResponseWriter, r *http.Request) {
	provider := strings.ToLower(chi.URLParam(r, "provider"))
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Redirect(w, r, "/?auth_error=no_code", http.StatusTemporaryRedirect)
		return
	}

	var email string
	var err error

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	switch provider {
	case "yandex":
		email, err = exchangeYandexCode(ctx, code)
	default:
		http.Redirect(w, r, "/?auth_error=unsupported_provider", http.StatusTemporaryRedirect)
		return
	}

	if err != nil || email == "" {
		http.Redirect(w, r, "/?auth_error=exchange_failed", http.StatusTemporaryRedirect)
		return
	}

	a.completeOAuthSession(w, r, email, provider)
}

func (a *API) completeOAuthSession(w http.ResponseWriter, r *http.Request, email, provider string) {
	sess, err := a.usecases.LoginOAuth(r.Context(), email)
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	isSecure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    sess.Token,
		Path:     "/",
		Expires:  sess.ExpiresAt,
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: http.SameSiteLaxMode,
	})

	http.Redirect(w, r, getFrontendReturnURL(r, provider), http.StatusTemporaryRedirect)
}

func getOAuthRedirectURI(r *http.Request, provider string) string {
	if custom := strings.TrimSpace(os.Getenv("OAUTH_REDIRECT_BASE_URL")); custom != "" {
		return fmt.Sprintf("%s/api/v1/auth/oauth/%s/callback", strings.TrimRight(custom, "/"), provider)
	}

	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := r.Host
	if strings.Contains(host, "localhost") || strings.Contains(host, "127.0.0.1") {
		host = "localhost:8080"
	}
	return fmt.Sprintf("%s://%s/api/v1/auth/oauth/%s/callback", scheme, host, provider)
}

func getFrontendReturnURL(r *http.Request, provider string) string {
	if strings.Contains(r.Host, "localhost") || strings.Contains(r.Host, "127.0.0.1") {
		return fmt.Sprintf("http://localhost:5173/?auth=success&provider=%s", provider)
	}
	return fmt.Sprintf("/?auth=success&provider=%s", provider)
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth Helpers
// ─────────────────────────────────────────────────────────────────────────────

func exchangeYandexCode(ctx context.Context, code string) (string, error) {
	clientID := os.Getenv("YANDEX_CLIENT_ID")
	clientSecret := os.Getenv("YANDEX_CLIENT_SECRET")

	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth.yandex.ru/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("yandex token status %d", resp.StatusCode)
	}

	var tokenResp struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return "", err
	}

	// Запрашиваем информацию о пользователе
	infoReq, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://login.yandex.ru/info?format=json", nil)
	if err != nil {
		return "", err
	}
	infoReq.Header.Set("Authorization", "OAuth "+tokenResp.AccessToken)

	infoResp, err := http.DefaultClient.Do(infoReq)
	if err != nil {
		return "", err
	}
	defer infoResp.Body.Close()

	if infoResp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("yandex info status %d", infoResp.StatusCode)
	}

	var info struct {
		DefaultEmail string   `json:"default_email"`
		Emails       []string `json:"emails"`
		Login        string   `json:"login"`
	}
	if err := json.NewDecoder(infoResp.Body).Decode(&info); err != nil {
		return "", err
	}

	if info.DefaultEmail != "" {
		return info.DefaultEmail, nil
	}
	if len(info.Emails) > 0 && info.Emails[0] != "" {
		return info.Emails[0], nil
	}
	if info.Login != "" {
		return info.Login + "@yandex.ru", nil
	}
	return "", fmt.Errorf("no email found in yandex profile")
}


package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
	"postcode/backend/internal/sms"
)

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type confirmCodeRequest struct {
	Email string `json:"email"`
	Code  string `json:"code"`
}

type resendCodeRequest struct {
	Email string `json:"email"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type sendPhoneCodeRequest struct {
	Phone string `json:"phone"`
}

type verifyPhoneCodeRequest struct {
	Code string `json:"code"`
}

type userDTO struct {
	ID            string  `json:"id"`
	Email         string  `json:"email"`
	Role          string  `json:"role"`
	IsTerminal    bool    `json:"isTerminal"`
	Confirmed     bool    `json:"confirmed"`
	Phone         *string `json:"phone,omitempty"`
	PhoneVerified bool    `json:"phoneVerified"`
}

type changeRoleRequest struct {
	Role string `json:"role"`
}

func toUserDTO(u domain.User) userDTO {
	return userDTO{
		ID:            u.ID,
		Email:         u.Email,
		Role:          string(u.Role),
		IsTerminal:    u.IsTerminal,
		Confirmed:     u.Confirmed,
		Phone:         u.Phone,
		PhoneVerified: u.PhoneVerified,
	}
}
// POST /api/v1/auth/register
func (a *API) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, r, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" || len(req.Password) < 6 {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION", "email required and password must be at least 6 characters")
		return
	}
	u, err := a.usecases.Register(r.Context(), req.Email, req.Password)
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	if !u.Confirmed && u.ConfirmCode != nil && u.ConfirmToken != nil {
		if a.mailer != nil {
			baseURL := getAppBaseURL(r)
			go func(email, code, token, appURL string) {
				ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
				defer cancel()
				if err := a.mailer.SendConfirmationEmail(ctx, email, code, token, appURL); err != nil {
					slog.Error("Failed to send confirmation email", "to", email, "error", err)
				}
			}(u.Email, *u.ConfirmCode, *u.ConfirmToken, baseURL)
		}
	}

	writeJSONResponse(w, http.StatusCreated, map[string]any{
		"id":                   u.ID,
		"email":                u.Email,
		"role":                 string(u.Role),
		"isTerminal":           u.IsTerminal,
		"confirmed":            u.Confirmed,
		"requiresConfirmation": !u.Confirmed,
		"message":              "Код подтверждения отправлен на вашу почту",
		"user":                 toUserDTO(u),
	})
}
// POST /api/v1/auth/confirm-code
func (a *API) ConfirmEmailCode(w http.ResponseWriter, r *http.Request) {
	var req confirmCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, r, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	req.Code = strings.TrimSpace(req.Code)
	if req.Email == "" || req.Code == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION", "email and code are required")
		return
	}

	sess, u, err := a.usecases.ConfirmEmailByCode(r.Context(), req.Email, req.Code)
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

	writeJSONResponse(w, http.StatusOK, map[string]any{
		"status": "confirmed",
		"user":   toUserDTO(u),
	})
}
// GET /api/v1/auth/confirm?token=...
func (a *API) ConfirmEmail(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Redirect(w, r, "/?auth_error=no_token", http.StatusTemporaryRedirect)
		return
	}
	sess, _, err := a.usecases.ConfirmEmailByToken(r.Context(), token)
	if err != nil {
		if errLegacy := a.usecases.ConfirmEmail(r.Context(), token); errLegacy == nil {
			http.Redirect(w, r, "/?auth=success&confirmed=email", http.StatusTemporaryRedirect)
			return
		}
		http.Redirect(w, r, "/?auth_error=invalid_token", http.StatusTemporaryRedirect)
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

	returnURL := "/?auth=success&confirmed=email"
	if strings.Contains(r.Host, "localhost") || strings.Contains(r.Host, "127.0.0.1") {
		returnURL = "http://localhost:5173/?auth=success&confirmed=email"
	}
	http.Redirect(w, r, returnURL, http.StatusTemporaryRedirect)
}
// POST /api/v1/auth/resend-code
func (a *API) ResendEmailCode(w http.ResponseWriter, r *http.Request) {
	var req resendCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, r, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))
	if req.Email == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION", "email required")
		return
	}

	code, token, err := a.usecases.ResendEmailConfirmation(r.Context(), req.Email)
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	if a.mailer != nil {
		baseURL := getAppBaseURL(r)
		go func(email, code, token, appURL string) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			if err := a.mailer.SendConfirmationEmail(ctx, email, code, token, appURL); err != nil {
				slog.Error("Failed to resend confirmation email", "to", email, "error", err)
			}
		}(req.Email, code, token, baseURL)
	}

	writeJSONResponse(w, http.StatusOK, map[string]string{
		"status":  "sent",
		"message": "Новый код подтверждения отправлен на вашу почту",
	})
}

func getAppBaseURL(r *http.Request) string {
	if strings.Contains(r.Host, "localhost") || strings.Contains(r.Host, "127.0.0.1") {
		return "http://localhost:8080"
	}
	if custom := strings.TrimSpace(os.Getenv("SMTP_APP_BASE_URL")); custom != "" {
		return strings.TrimRight(custom, "/")
	}
	scheme := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	return fmt.Sprintf("%s://%s", scheme, r.Host)
}
// POST /api/v1/auth/login
const sessionCookie = "session"

type loginLimiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
}

var defaultLoginLimiter = &loginLimiter{
	attempts: make(map[string][]time.Time),
}

func (l *loginLimiter) allow(key string, maxAttempts int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-window)

	times := l.attempts[key]
	valid := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			valid = append(valid, t)
		}
	}

	if len(valid) >= maxAttempts {
		l.attempts[key] = valid
		return false
	}

	valid = append(valid, now)
	l.attempts[key] = valid

	if len(l.attempts) > 10000 {
		for k, v := range l.attempts {
			if len(v) == 0 || v[len(v)-1].Before(cutoff) {
				delete(l.attempts, k)
			}
		}
	}
	return true
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return ip
	}
	return r.RemoteAddr
}

func (a *API) Login(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r)
	if !defaultLoginLimiter.allow(ip, 20, time.Minute) {
		writeJSONError(w, r, http.StatusTooManyRequests, "RATE_LIMITED", "too many login attempts, please try again later")
		return
	}

	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, r, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	req.Email = strings.TrimSpace(strings.ToLower(req.Email))

	sess, err := a.usecases.Login(r.Context(), req.Email, req.Password)
	if errors.Is(err, application.ErrNotFound) {
		writeJSONError(w, r, http.StatusUnauthorized, "INVALID_CREDENTIALS", "invalid credentials")
		return
	}
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
	writeJSONResponse(w, http.StatusOK, map[string]string{"status": "ok"})
}
// POST /api/v1/auth/logout
func (a *API) Logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookie)
	if err == nil {
		if err := a.usecases.Logout(r.Context(), cookie.Value); err != nil {
			a.respondError(w, r, err)
			return
		}
	}
	isSecure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: http.SameSiteLaxMode,
	})
	writeJSONResponse(w, http.StatusOK, map[string]string{"status": "ok"})
}
// GET /api/v1/auth/me
func (a *API) GetMe(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "not authenticated")
		return
	}
	writeJSONResponse(w, http.StatusOK, toUserDTO(u))
}
// GET /api/v1/admin/users  (только opc_chief)
func (a *API) ListUsers(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := paginationParams(w, r)
	if !ok {
		return
	}
	search := strings.TrimSpace(r.URL.Query().Get("search"))
	role := strings.TrimSpace(r.URL.Query().Get("role"))
	users, err := a.usecases.ListUsers(r.Context(), limit, offset, search, role)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	dtos := make([]userDTO, len(users.Items))
	for i, u := range users.Items {
		dtos[i] = toUserDTO(u)
	}
	writeJSONResponse(w, http.StatusOK, map[string]interface{}{"items": dtos, "total": users.Total, "counts": users.Counts, "limit": limit, "offset": offset})
}

func paginationParams(w http.ResponseWriter, r *http.Request) (int, int, bool) {
	limit, offset := 50, 0
	var err error
	if raw := r.URL.Query().Get("limit"); raw != "" {
		limit, err = strconv.Atoi(raw)
	}
	if err != nil || limit < 1 || limit > 50 {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "limit must be between 1 and 50")
		return 0, 0, false
	}
	if raw := r.URL.Query().Get("offset"); raw != "" {
		offset, err = strconv.Atoi(raw)
	}
	if err != nil || offset < 0 {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "offset must be zero or greater")
		return 0, 0, false
	}
	return limit, offset, true
}
// PUT /api/v1/admin/users/{userID}/role  (только opc_chief)
func (a *API) ChangeUserRole(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userID")
	var req changeRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, r, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	role := domain.UserRole(req.Role)
	switch role {
	case domain.RoleClient, domain.RoleEmployee, domain.RoleOPCChief, domain.RoleTerminal:
	default:
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION", "invalid role: must be client|employee|opc_chief|terminal")
		return
	}
	u, err := a.usecases.ChangeUserRole(r.Context(), userID, role)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, toUserDTO(u))
}
// POST /api/v1/auth/profile/phone/send-code
func (a *API) SendPhoneCode(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "login required")
		return
	}
	var req sendPhoneCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, r, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	normalized, err := sms.NormalizePhone(req.Phone)
	if err != nil {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error())
		return
	}

	codeInt, err := rand.Int(rand.Reader, big.NewInt(9000))
	var code string
	if err != nil {
		code = "1234"
	} else {
		code = fmt.Sprintf("%04d", codeInt.Int64()+1000)
	}

	expiresAt := time.Now().Add(5 * time.Minute)
	if err := a.usecases.SetUserPhoneCode(r.Context(), u.ID, normalized, code, expiresAt); err != nil {
		a.respondError(w, r, err)
		return
	}

		msg := fmt.Sprintf("Код подтверждения для Почты России: %s", code)
	if a.smsClient != nil {
		_ = a.smsClient.Send(r.Context(), normalized, msg)
	}

	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"status":    "ok",
		"phone":     normalized,
		"expiresIn": 300,
	})
}
// POST /api/v1/auth/profile/phone/verify-code
func (a *API) VerifyPhoneCode(w http.ResponseWriter, r *http.Request) {
	u, ok := userFromContext(r.Context())
	if !ok {
		writeJSONError(w, r, http.StatusUnauthorized, "UNAUTHENTICATED", "login required")
		return
	}
	var req verifyPhoneCodeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSONError(w, r, http.StatusBadRequest, "BAD_REQUEST", "invalid request body")
		return
	}
	code := strings.TrimSpace(req.Code)
	if code == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "code is required")
		return
	}

	updatedUser, err := a.usecases.VerifyUserPhoneCode(r.Context(), u.ID, code)
	if err != nil {
		if errors.Is(err, application.ErrInvalidState) {
			writeJSONError(w, r, http.StatusBadRequest, "INVALID_CODE", "Неверный или просроченный код")
			return
		}
		a.respondError(w, r, err)
		return
	}

	writeJSONResponse(w, http.StatusOK, toUserDTO(updatedUser))
}

package persistence

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

type contextKey string

const (
	manageTokenCtxKey contextKey = "postcode_manage_token"
	staffBypassCtxKey contextKey = "postcode_staff_bypass"
)

var tokenHMACSecret = []byte("postcode-secure-ticket-management-secret-key-32b")

// DeterministicManagementToken derives a 256-bit cryptographically secure management token
// from the server secret and creation idempotency key.
func DeterministicManagementToken(idempotencyKey string) (rawToken string, tokenHash string) {
	mac := hmac.New(sha256.New, tokenHMACSecret)
	mac.Write([]byte("ticket-mgmt-token:" + idempotencyKey))
	rawToken = hex.EncodeToString(mac.Sum(nil))
	tokenHash = HashManagementToken(rawToken)
	return rawToken, tokenHash
}

// HashManagementToken returns SHA-256 hex digest of the raw management token.
func HashManagementToken(rawToken string) string {
	h := sha256.Sum256([]byte(strings.TrimSpace(rawToken)))
	return hex.EncodeToString(h[:])
}

// WithManagementToken attaches the client's management token to context.
func WithManagementToken(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, manageTokenCtxKey, strings.TrimSpace(token))
}

// ManagementTokenFromContext retrieves the management token from context if present.
func ManagementTokenFromContext(ctx context.Context) (string, bool) {
	if v, ok := ctx.Value(manageTokenCtxKey).(string); ok && v != "" {
		return v, true
	}
	return "", false
}

// WithStaffBypass marks the context as an authenticated staff action bypassing client token checks.
func WithStaffBypass(ctx context.Context) context.Context {
	return context.WithValue(ctx, staffBypassCtxKey, true)
}

// IsStaffBypass returns true if the context contains staff authorization.
func IsStaffBypass(ctx context.Context) bool {
	if v, ok := ctx.Value(staffBypassCtxKey).(bool); ok && v {
		return true
	}
	return false
}

const publicClientCtxKey contextKey = "postcode_public_client"

// WithPublicClient marks the context as originating from a public unauthenticated client.
func WithPublicClient(ctx context.Context) context.Context {
	return context.WithValue(ctx, publicClientCtxKey, true)
}

// IsPublicClient returns true if the context originated from a public unauthenticated client.
func IsPublicClient(ctx context.Context) bool {
	if v, ok := ctx.Value(publicClientCtxKey).(bool); ok && v {
		return true
	}
	return false
}

const clientOwnerCtxKey contextKey = "postcode_client_owner"

// WithClientOwner marks the context with the authenticated client user ID.
func WithClientOwner(ctx context.Context, clientID string) context.Context {
	return context.WithValue(ctx, clientOwnerCtxKey, strings.TrimSpace(clientID))
}

// ClientOwnerFromContext retrieves the authenticated client user ID from context.
func ClientOwnerFromContext(ctx context.Context) (string, bool) {
	if v, ok := ctx.Value(clientOwnerCtxKey).(string); ok && v != "" {
		return v, true
	}
	return "", false
}

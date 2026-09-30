package persistence

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

const sessionTTL = 7 * 24 * time.Hour

// ─────────────────────────────────────────────────────────────────────────────
// Register
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) Register(ctx context.Context, email, password string) (domain.User, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return domain.User{}, fmt.Errorf("hashing password: %w", err)
	}

	// Генерация 6-значного кода и токена
	codeBytes := make([]byte, 3)
	if _, err := rand.Read(codeBytes); err != nil {
		return domain.User{}, fmt.Errorf("generating code: %w", err)
	}
	codeVal := (int(codeBytes[0])<<16 | int(codeBytes[1])<<8 | int(codeBytes[2])) % 1000000
	code := fmt.Sprintf("%06d", codeVal)

	token, err := randomToken()
	if err != nil {
		return domain.User{}, fmt.Errorf("generating token: %w", err)
	}
	expiresAt := time.Now().Add(15 * time.Minute)

	// Для тестовых доменов (.invalid) подтверждение автоматическое
	autoConfirm := strings.HasSuffix(email, ".invalid")
	confirmed := autoConfirm

	var u domain.User
	err = p.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, confirmed, confirm_token, confirm_code, confirm_code_expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (email) DO UPDATE
		  SET password_hash = EXCLUDED.password_hash,
		      confirm_token = EXCLUDED.confirm_token,
		      confirm_code = EXCLUDED.confirm_code,
		      confirm_code_expires_at = EXCLUDED.confirm_code_expires_at
		  WHERE users.confirmed = false
		RETURNING id::text, email, password_hash, role, is_terminal, confirmed, confirm_token, confirm_code, confirm_code_expires_at, created_at
	`, email, string(hash), confirmed, token, code, expiresAt).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Role,
		&u.IsTerminal, &u.Confirmed, &u.ConfirmToken, &u.ConfirmCode, &u.ConfirmCodeExpiresAt, &u.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// Конфликт с уже подтвержденным пользователем
		return domain.User{}, application.ErrIdempotencyConflict
	}
	if err != nil {
		return domain.User{}, dbError(err)
	}
	return u, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfirmEmail (стандартная заглушка)
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) ConfirmEmail(ctx context.Context, token string) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE users SET confirmed = true, confirm_token = NULL, confirm_code = NULL, confirm_code_expires_at = NULL
		WHERE confirm_token = $1 AND confirmed = false
	`, token)
	if err != nil {
		return dbError(err)
	}
	if tag.RowsAffected() == 0 {
		return application.ErrNotFound
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfirmEmailByCode — подтверждает пользователя по 6-значному коду и создает сессию
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) ConfirmEmailByCode(ctx context.Context, email, code string) (domain.Session, domain.User, error) {
	email = strings.TrimSpace(strings.ToLower(email))
	code = strings.TrimSpace(code)

	var u domain.User
	err := p.pool.QueryRow(ctx, `
		UPDATE users
		SET confirmed = true, confirm_code = NULL, confirm_token = NULL, confirm_code_expires_at = NULL
		WHERE lower(email) = lower($1)
		  AND confirm_code = $2
		  AND (confirm_code_expires_at IS NULL OR confirm_code_expires_at > now())
		RETURNING id::text, email, password_hash, role, is_terminal, confirmed, created_at, phone, phone_verified
	`, email, code).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsTerminal, &u.Confirmed, &u.CreatedAt, &u.Phone, &u.PhoneVerified,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Session{}, domain.User{}, fmt.Errorf("invalid or expired confirmation code: %w", application.ErrInvalidState)
	}
	if err != nil {
		return domain.Session{}, domain.User{}, dbError(err)
	}

	token, err := randomToken()
	if err != nil {
		return domain.Session{}, domain.User{}, err
	}
	expiresAt := time.Now().Add(sessionTTL)
	_, err = p.pool.Exec(ctx, `
		INSERT INTO sessions (token, user_id, expires_at)
		VALUES ($1, $2::uuid, $3)
	`, token, u.ID, expiresAt)
	if err != nil {
		return domain.Session{}, domain.User{}, dbError(err)
	}

	return domain.Session{Token: token, UserID: u.ID, ExpiresAt: expiresAt}, u, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// ConfirmEmailByToken — подтверждает пользователя по URL-токену и создает сессию
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) ConfirmEmailByToken(ctx context.Context, token string) (domain.Session, domain.User, error) {
	token = strings.TrimSpace(token)

	var u domain.User
	err := p.pool.QueryRow(ctx, `
		UPDATE users
		SET confirmed = true, confirm_code = NULL, confirm_token = NULL, confirm_code_expires_at = NULL
		WHERE confirm_token = $1
		  AND (confirm_code_expires_at IS NULL OR confirm_code_expires_at > now())
		RETURNING id::text, email, password_hash, role, is_terminal, confirmed, created_at, phone, phone_verified
	`, token).Scan(
		&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsTerminal, &u.Confirmed, &u.CreatedAt, &u.Phone, &u.PhoneVerified,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Session{}, domain.User{}, fmt.Errorf("invalid or expired confirmation token: %w", application.ErrInvalidState)
	}
	if err != nil {
		return domain.Session{}, domain.User{}, dbError(err)
	}

	sessToken, err := randomToken()
	if err != nil {
		return domain.Session{}, domain.User{}, err
	}
	expiresAt := time.Now().Add(sessionTTL)
	_, err = p.pool.Exec(ctx, `
		INSERT INTO sessions (token, user_id, expires_at)
		VALUES ($1, $2::uuid, $3)
	`, sessToken, u.ID, expiresAt)
	if err != nil {
		return domain.Session{}, domain.User{}, dbError(err)
	}

	return domain.Session{Token: sessToken, UserID: u.ID, ExpiresAt: expiresAt}, u, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// ResendEmailConfirmation — генерирует новый код и токен для неподтвержденного пользователя
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) ResendEmailConfirmation(ctx context.Context, email string) (string, string, error) {
	email = strings.TrimSpace(strings.ToLower(email))

	codeBytes := make([]byte, 3)
	if _, err := rand.Read(codeBytes); err != nil {
		return "", "", fmt.Errorf("generating code: %w", err)
	}
	codeVal := (int(codeBytes[0])<<16 | int(codeBytes[1])<<8 | int(codeBytes[2])) % 1000000
	code := fmt.Sprintf("%06d", codeVal)

	token, err := randomToken()
	if err != nil {
		return "", "", fmt.Errorf("generating token: %w", err)
	}
	expiresAt := time.Now().Add(15 * time.Minute)

	tag, err := p.pool.Exec(ctx, `
		UPDATE users
		SET confirm_code = $1, confirm_token = $2, confirm_code_expires_at = $3
		WHERE lower(email) = lower($4) AND confirmed = false
	`, code, token, expiresAt, email)
	if err != nil {
		return "", "", dbError(err)
	}
	if tag.RowsAffected() == 0 {
		return "", "", fmt.Errorf("user not found or already confirmed: %w", application.ErrNotFound)
	}

	return code, token, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) Login(ctx context.Context, email, password string) (domain.Session, error) {
	var u domain.User
	err := p.pool.QueryRow(ctx, `
		SELECT id::text, email, password_hash, role, is_terminal, confirmed
		FROM users WHERE email = $1
	`, email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsTerminal, &u.Confirmed)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Session{}, application.ErrNotFound
	}
	if err != nil {
		return domain.Session{}, dbError(err)
	}
	if !u.Confirmed {
		return domain.Session{}, fmt.Errorf("email not confirmed: %w", application.ErrInvalidState)
	}
	if err = bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return domain.Session{}, application.ErrNotFound // не раскрываем причину
	}

	token, err := randomToken()
	if err != nil {
		return domain.Session{}, err
	}
	expiresAt := time.Now().Add(sessionTTL)
	_, err = p.pool.Exec(ctx, `
		INSERT INTO sessions (token, user_id, expires_at)
		VALUES ($1, $2::uuid, $3)
	`, token, u.ID, expiresAt)
	if err != nil {
		return domain.Session{}, dbError(err)
	}
	return domain.Session{Token: token, UserID: u.ID, ExpiresAt: expiresAt}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// LoginOAuth (VK, Yandex, etc.)
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) LoginOAuth(ctx context.Context, email string) (domain.Session, error) {
	var u domain.User
	err := p.pool.QueryRow(ctx, `
		SELECT id::text, email, password_hash, role, is_terminal, confirmed
		FROM users WHERE email = $1
	`, email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsTerminal, &u.Confirmed)

	if errors.Is(err, pgx.ErrNoRows) {
		var newID string
		err = p.pool.QueryRow(ctx, `
			INSERT INTO users (email, password_hash, role, is_terminal, confirmed)
			VALUES ($1, 'OAUTH_ACCOUNT', 'client', false, true)
			RETURNING id::text
		`, email).Scan(&newID)
		if err != nil {
			return domain.Session{}, dbError(err)
		}
		u.ID = newID
		u.Email = email
		u.Role = domain.RoleClient
		u.Confirmed = true
	} else if err != nil {
		return domain.Session{}, dbError(err)
	}

	token, err := randomToken()
	if err != nil {
		return domain.Session{}, err
	}
	expiresAt := time.Now().Add(sessionTTL)
	_, err = p.pool.Exec(ctx, `
		INSERT INTO sessions (token, user_id, expires_at)
		VALUES ($1, $2::uuid, $3)
	`, token, u.ID, expiresAt)
	if err != nil {
		return domain.Session{}, dbError(err)
	}
	return domain.Session{Token: token, UserID: u.ID, ExpiresAt: expiresAt}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Logout
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) Logout(ctx context.Context, token string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM sessions WHERE token = $1`, token)
	return dbError(err)
}

// ─────────────────────────────────────────────────────────────────────────────
// GetSessionUser
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) GetSessionUser(ctx context.Context, token string) (domain.User, error) {
	var u domain.User
	err := p.pool.QueryRow(ctx, `
		SELECT u.id::text, u.email, u.password_hash, u.role, u.is_terminal, u.confirmed, u.phone, u.phone_verified
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token = $1 AND s.expires_at > clock_timestamp()
	`, token).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsTerminal, &u.Confirmed, &u.Phone, &u.PhoneVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, application.ErrNotFound
	}
	return u, dbError(err)
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone Verification & SMS
// ─────────────────────────────────────────────────────────────────────────────

// SetUserPhoneCode saves a verification code and its expiry for a user's phone.
func (p *Postgres) SetUserPhoneCode(ctx context.Context, userID, phone, code string, expiresAt time.Time) error {
	tag, err := p.pool.Exec(ctx, `
		UPDATE users
		SET phone = $2, phone_code = $3, phone_code_expires_at = $4
		WHERE id = $1::uuid
	`, userID, phone, code, expiresAt)
	if err != nil {
		return dbError(err)
	}
	if tag.RowsAffected() == 0 {
		return application.ErrNotFound
	}
	return nil
}

// VerifyUserPhoneCode verifies the code and marks phone as verified.
func (p *Postgres) VerifyUserPhoneCode(ctx context.Context, userID, code string) (domain.User, error) {
	var u domain.User
	var actualCode *string
	var expiresAt *time.Time

	err := p.pool.QueryRow(ctx, `
		SELECT id::text, email, password_hash, role, is_terminal, confirmed, phone, phone_verified, phone_code, phone_code_expires_at
		FROM users
		WHERE id = $1::uuid
	`, userID).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsTerminal, &u.Confirmed, &u.Phone, &u.PhoneVerified, &actualCode, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, application.ErrNotFound
	}
	if err != nil {
		return domain.User{}, dbError(err)
	}

	if actualCode == nil || *actualCode != code {
		return domain.User{}, fmt.Errorf("invalid verification code: %w", application.ErrInvalidState)
	}
	if expiresAt != nil && time.Now().After(*expiresAt) {
		return domain.User{}, fmt.Errorf("verification code expired: %w", application.ErrInvalidState)
	}

	err = p.pool.QueryRow(ctx, `
		UPDATE users
		SET phone_verified = true, phone_code = NULL, phone_code_expires_at = NULL
		WHERE id = $1::uuid
		RETURNING id::text, email, password_hash, role, is_terminal, confirmed, phone, phone_verified
	`, userID).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsTerminal, &u.Confirmed, &u.Phone, &u.PhoneVerified)
	if err != nil {
		return domain.User{}, dbError(err)
	}
	return u, nil
}

// FindPendingSMSAppointments retrieves upcoming appointments within windowMinutes whose users have verified phones.
func (p *Postgres) FindPendingSMSAppointments(ctx context.Context, windowMinutes int) ([]domain.AppointmentSMSNotification, error) {
	query := `
		SELECT t.id::text, t.public_number, b.name, t.scheduled_at, u.phone
		FROM tickets t
		JOIN branches b ON b.id = t.branch_id
		JOIN users u ON u.id::text = t.client_id
		WHERE t.source = 'APPOINTMENT'
		  AND t.status = 'SCHEDULED'
		  AND t.sms_reminder_sent = false
		  AND u.phone_verified = true
		  AND u.phone IS NOT NULL
		  AND t.scheduled_at <= (clock_timestamp() + make_interval(mins => $1))
		  AND t.scheduled_at >= clock_timestamp()
		ORDER BY t.scheduled_at ASC
		LIMIT 50
	`
	rows, err := p.pool.Query(ctx, query, windowMinutes)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()

	var list []domain.AppointmentSMSNotification
	for rows.Next() {
		var item domain.AppointmentSMSNotification
		if err := rows.Scan(&item.TicketID, &item.PublicNumber, &item.BranchName, &item.ScheduledAt, &item.Phone); err != nil {
			return nil, dbError(err)
		}
		item.ScheduledAt = item.ScheduledAt.UTC()
		list = append(list, item)
	}
	return list, dbError(rows.Err())
}

// MarkSMSAppointmentReminderSent flags that the SMS reminder was dispatched.
func (p *Postgres) MarkSMSAppointmentReminderSent(ctx context.Context, ticketID string) error {
	_, err := p.pool.Exec(ctx, `UPDATE tickets SET sms_reminder_sent = true WHERE id = $1::uuid`, ticketID)
	return dbError(err)
}

// ─────────────────────────────────────────────────────────────────────────────
// ListUsers (только для opc_chief)
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) ListUsers(ctx context.Context, limit, offset int, search, role string) (domain.UserPage, error) {
	var page domain.UserPage
	query := `
		SELECT id::text, email, role, is_terminal, confirmed, created_at, phone, phone_verified
		FROM users
		WHERE ($3 = '' OR email ILIKE '%' || $3 || '%' OR role::text ILIKE '%' || $3 || '%')
		  AND ($4 = '' OR ($4 = 'terminal' AND is_terminal) OR role::text = $4)
		ORDER BY created_at DESC, id DESC
		LIMIT $1 OFFSET $2`
	rows, err := p.pool.Query(ctx, query, limit, offset, search, role)
	if err != nil {
		return page, dbError(err)
	}
	defer rows.Close()
	page.Items = make([]domain.User, 0, limit)
	for rows.Next() {
		var u domain.User
		if err = rows.Scan(&u.ID, &u.Email, &u.Role, &u.IsTerminal, &u.Confirmed, &u.CreatedAt, &u.Phone, &u.PhoneVerified); err != nil {
			return page, dbError(err)
		}
		page.Items = append(page.Items, u)
	}
	if err = rows.Err(); err != nil {
		return page, dbError(err)
	}
	err = p.pool.QueryRow(ctx, `
		SELECT COUNT(*) FILTER (WHERE $2 = '' OR ($2 = 'terminal' AND is_terminal) OR role::text = $2),
		       COUNT(*),
		       COUNT(*) FILTER (WHERE role::text = 'employee'),
		       COUNT(*) FILTER (WHERE role::text = 'opc_chief'),
		       COUNT(*) FILTER (WHERE role::text = 'client'),
		       COUNT(*) FILTER (WHERE role::text = 'terminal' OR is_terminal)
		FROM users
		WHERE ($1 = '' OR email ILIKE '%' || $1 || '%' OR role::text ILIKE '%' || $1 || '%')
	`, search, role).Scan(&page.Total, &page.Counts.All, &page.Counts.Employee,
		&page.Counts.OPCChief, &page.Counts.Client, &page.Counts.Terminal)
	return page, dbError(err)
}

// ─────────────────────────────────────────────────────────────────────────────
// ChangeUserRole (только для opc_chief)
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) ChangeUserRole(ctx context.Context, userID string, role domain.UserRole) (domain.User, error) {
	var u domain.User
	err := p.pool.QueryRow(ctx, `
		UPDATE users SET role = $1 WHERE id = $2::uuid
		RETURNING id::text, email, role, is_terminal, confirmed, created_at, phone, phone_verified
	`, string(role), userID).Scan(&u.ID, &u.Email, &u.Role, &u.IsTerminal, &u.Confirmed, &u.CreatedAt, &u.Phone, &u.PhoneVerified)
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.User{}, application.ErrNotFound
	}
	return u, dbError(err)
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generating token: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// ─────────────────────────────────────────────────────────────────────────────
// GetOrCreateExternalUser (для голосовых помощников / внешних аккаунтов)
// ─────────────────────────────────────────────────────────────────────────────

func (p *Postgres) GetOrCreateExternalUser(ctx context.Context, provider, externalUserID string) (domain.User, error) {
	provider = strings.TrimSpace(strings.ToLower(provider))
	externalUserID = strings.TrimSpace(externalUserID)
	if provider == "" || externalUserID == "" {
		return domain.User{}, errors.New("provider and externalUserID required")
	}

	// 1. Поиск существующей связки в external_accounts
	var userID string
	err := p.pool.QueryRow(ctx, `
		SELECT user_id::text
		FROM external_accounts
		WHERE provider = $1 AND external_user_id = $2
	`, provider, externalUserID).Scan(&userID)
	if err == nil {
		var u domain.User
		err = p.pool.QueryRow(ctx, `
			SELECT id::text, email, password_hash, role, is_terminal, confirmed, phone, phone_verified, created_at
			FROM users
			WHERE id = $1::uuid
		`, userID).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsTerminal, &u.Confirmed, &u.Phone, &u.PhoneVerified, &u.CreatedAt)
		if err == nil {
			return u, nil
		}
	}

	// 2. Создание пользователя и связки external_accounts
	cleanID := strings.ReplaceAll(externalUserID, "-", "")
	if len(cleanID) > 24 {
		cleanID = cleanID[:24]
	}
	syntheticEmail := fmt.Sprintf("%s_%s@alice.yandex.ru", provider, cleanID)

	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return domain.User{}, dbError(err)
	}
	defer tx.Rollback(context.Background())

	var u domain.User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, role, confirmed)
		VALUES ($1, 'external_voice_auth', 'client', true)
		ON CONFLICT (email) DO UPDATE SET confirmed = true
		RETURNING id::text, email, password_hash, role, is_terminal, confirmed, phone, phone_verified, created_at
	`, syntheticEmail).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.Role, &u.IsTerminal, &u.Confirmed, &u.Phone, &u.PhoneVerified, &u.CreatedAt)
	if err != nil {
		return domain.User{}, dbError(err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO external_accounts (user_id, provider, external_user_id)
		VALUES ($1::uuid, $2, $3)
		ON CONFLICT (provider, external_user_id) DO UPDATE SET updated_at = clock_timestamp()
	`, u.ID, provider, externalUserID)
	if err != nil {
		return domain.User{}, dbError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return domain.User{}, dbError(err)
	}

	return u, nil
}


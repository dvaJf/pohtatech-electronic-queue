package persistence

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func notificationToken() (string, string, error) {
	raw := make([]byte, 32) // 256 bits; safe to put only this opaque value in Telegram start.
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	return token, hex.EncodeToString(sum[:]), nil
}

func (p *Postgres) checkNotificationTicketAccess(ctx context.Context, ticketID string) error {
	if IsStaffBypass(ctx) {
		return nil
	}
	token, ok := ManagementTokenFromContext(ctx)
	if !ok {
		return application.ErrForbidden
	}
	var expected string
	if err := p.pool.QueryRow(ctx, `SELECT management_token_hash FROM tickets WHERE id=$1::uuid`, ticketID).Scan(&expected); err != nil {
		return dbError(err)
	}
	if expected == "" || HashManagementToken(token) != expected {
		return application.ErrForbidden
	}
	return nil
}

func (p *Postgres) ListNotificationSubscriptions(ctx context.Context, ticketID string) ([]domain.NotificationSubscription, error) {
	if err := p.checkNotificationTicketAccess(ctx, ticketID); err != nil {
		return nil, err
	}
	rows, err := p.pool.Query(ctx, `SELECT id::text,ticket_id::text,channel,destination,enabled FROM notification_subscriptions WHERE ticket_id=$1::uuid ORDER BY channel, created_at`, ticketID)
	if err != nil {
		return nil, dbError(err)
	}
	defer rows.Close()
	result := []domain.NotificationSubscription{}
	for rows.Next() {
		var s domain.NotificationSubscription
		var channel string
		if err := rows.Scan(&s.ID, &s.TicketID, &channel, &s.Destination, &s.Enabled); err != nil {
			return nil, dbError(err)
		}
		s.Channel = domain.NotificationChannel(channel)
		result = append(result, s)
	}
	return result, rows.Err()
}

func (p *Postgres) UpsertNotificationSubscription(ctx context.Context, ticketID string, channel domain.NotificationChannel, destination string) (domain.NotificationSubscription, error) {
	var empty domain.NotificationSubscription
	if err := p.checkNotificationTicketAccess(ctx, ticketID); err != nil {
		return empty, err
	}
	destination = strings.TrimSpace(destination)
	if destination == "" {
		return empty, fmt.Errorf("destination is required")
	}
	var s domain.NotificationSubscription
	var ch string
	err := p.pool.QueryRow(ctx, `INSERT INTO notification_subscriptions(ticket_id,channel,destination,enabled,updated_at) VALUES($1::uuid,$2,$3,true,clock_timestamp()) ON CONFLICT(ticket_id,channel,destination) DO UPDATE SET enabled=true,updated_at=clock_timestamp() RETURNING id::text,ticket_id::text,channel,destination,enabled`, ticketID, string(channel), destination).Scan(&s.ID, &s.TicketID, &ch, &s.Destination, &s.Enabled)
	if err != nil {
		return empty, dbError(err)
	}
	s.Channel = domain.NotificationChannel(ch)
	return s, nil
}

func (p *Postgres) DisableNotificationSubscription(ctx context.Context, ticketID, channel string, subscriptionID string) error {
	if err := p.checkNotificationTicketAccess(ctx, ticketID); err != nil {
		return err
	}
	tag, err := p.pool.Exec(ctx, `UPDATE notification_subscriptions SET enabled=false,updated_at=clock_timestamp() WHERE id=$1::uuid AND ticket_id=$2::uuid AND channel=$3`, subscriptionID, ticketID, channel)
	if err != nil {
		return dbError(err)
	}
	if tag.RowsAffected() == 0 {
		return application.ErrNotFound
	}
	return nil
}

func (p *Postgres) CreateTelegramLink(ctx context.Context, ticketID string) (string, error) {
	if err := p.checkNotificationTicketAccess(ctx, ticketID); err != nil {
		return "", err
	}
	token, hash, err := notificationToken()
	if err != nil {
		return "", err
	}
	_, err = p.pool.Exec(ctx, `INSERT INTO telegram_link_tokens(ticket_id,token_hash,expires_at) VALUES($1::uuid,$2,clock_timestamp()+interval '15 minutes')`, ticketID, hash)
	return token, dbError(err)
}

// ConsumeTelegramLink consumes the token in one UPDATE, so concurrent /start calls can bind only once.
func (p *Postgres) ConsumeTelegramLink(ctx context.Context, token, chatID string) (domain.NotificationSubscription, error) {
	var empty domain.NotificationSubscription
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	hash := hex.EncodeToString(sum[:])
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return empty, dbError(err)
	}
	defer tx.Rollback(ctx)
	var ticketID string
	err = tx.QueryRow(ctx, `UPDATE telegram_link_tokens SET consumed_at=clock_timestamp() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING ticket_id::text`, hash).Scan(&ticketID)
	if err != nil {
		return empty, application.ErrNotFound
	}
	var s domain.NotificationSubscription
	var ch string
	err = tx.QueryRow(ctx, `INSERT INTO notification_subscriptions(ticket_id,channel,destination,enabled,updated_at) VALUES($1::uuid,'TELEGRAM',$2,true,clock_timestamp()) ON CONFLICT(ticket_id,channel,destination) DO UPDATE SET enabled=true,updated_at=clock_timestamp() RETURNING id::text,ticket_id::text,channel,destination,enabled`, ticketID, strings.TrimSpace(chatID)).Scan(&s.ID, &s.TicketID, &ch, &s.Destination, &s.Enabled)
	if err != nil {
		return empty, dbError(err)
	}
	s.Channel = domain.NotificationChannel(ch)
	if err = tx.Commit(ctx); err != nil {
		return empty, dbError(err)
	}
	return s, nil
}

func (p *Postgres) DisableTelegramForChat(ctx context.Context, chatID string) error {
	_, err := p.pool.Exec(ctx, `UPDATE notification_subscriptions SET enabled=false,updated_at=clock_timestamp() WHERE channel='TELEGRAM' AND destination=$1`, strings.TrimSpace(chatID))
	return dbError(err)
}

func (p *Postgres) DisableSubscriptionByID(ctx context.Context, id string) error {
	_, err := p.pool.Exec(ctx, `UPDATE notification_subscriptions SET enabled=false,updated_at=clock_timestamp() WHERE id=$1::uuid`, id)
	return dbError(err)
}

func (p *Postgres) EnqueueAppointmentNotifications(ctx context.Context, ticketID string, scheduledAt time.Time, email, phone string) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return dbError(err)
	}
	defer tx.Rollback(ctx)
	err = p.enqueueAppointmentNotificationsTx(ctx, tx, ticketID, scheduledAt, email, phone)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (p *Postgres) enqueueAppointmentNotificationsTx(ctx context.Context, tx pgx.Tx, ticketID string, scheduledAt time.Time, email, phone string) error {
	if strings.TrimSpace(email) == "" && strings.TrimSpace(phone) == "" {
		return nil
	}
	var branchID, publicNumber, serviceName, branchName, address string
	err := tx.QueryRow(ctx, `SELECT t.branch_id::text,t.public_number,s.name,b.name,b.address FROM tickets t JOIN services s ON s.id=t.service_id JOIN branches b ON b.id=t.branch_id WHERE t.id=$1::uuid`, ticketID).Scan(&branchID, &publicNumber, &serviceName, &branchName, &address)
	if err != nil {
		return dbError(err)
	}
	for _, item := range []struct {
		channel     domain.NotificationChannel
		destination string
		event       domain.NotificationEventType
		available   time.Time
	}{{domain.NotificationChannelEmail, email, domain.NotificationAppointmentConfirmation, time.Now().UTC()}, {domain.NotificationChannelSMS, phone, domain.NotificationAppointmentReminder, maxTime(time.Now().UTC(), scheduledAt.Add(-30*time.Minute))}} {
		if strings.TrimSpace(item.destination) == "" {
			continue
		}
		sub, err := upsertSubscriptionTx(ctx, tx, ticketID, item.channel, item.destination)
		if err != nil {
			return err
		}
		key := fmt.Sprintf("%s:%s:%s:%s", item.event, ticketID, item.channel, sub.ID)
		payload := fmt.Sprintf(`{"publicNumber":%q,"branchName":%q,"address":%q,"serviceName":%q,"scheduledAt":%q}`, publicNumber, branchName, address, serviceName, scheduledAt.UTC().Format(time.RFC3339))
		_, err = tx.Exec(ctx, `INSERT INTO notification_outbox(ticket_id,branch_id,event_type,channel,subscription_id,destination,dedupe_key,payload,status,available_at,next_attempt_at,created_at) VALUES($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7,$8::jsonb,'PENDING',$9,$9,clock_timestamp()) ON CONFLICT(dedupe_key) DO NOTHING`, ticketID, branchID, string(item.event), string(item.channel), sub.ID, sub.Destination, key, payload, item.available)
		if err != nil {
			return dbError(err)
		}
	}
	return nil
}

func maxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}
func upsertSubscriptionTx(ctx context.Context, tx pgx.Tx, ticketID string, ch domain.NotificationChannel, destination string) (domain.NotificationSubscription, error) {
	var s domain.NotificationSubscription
	var channel string
	err := tx.QueryRow(ctx, `INSERT INTO notification_subscriptions(ticket_id,channel,destination,enabled,updated_at) VALUES($1::uuid,$2,$3,true,clock_timestamp()) ON CONFLICT(ticket_id,channel,destination) DO UPDATE SET enabled=true,updated_at=clock_timestamp() RETURNING id::text,ticket_id::text,channel,destination,enabled`, ticketID, string(ch), strings.TrimSpace(destination)).Scan(&s.ID, &s.TicketID, &channel, &s.Destination, &s.Enabled)
	if err != nil {
		return s, dbError(err)
	}
	s.Channel = domain.NotificationChannel(channel)
	return s, nil
}

package notification

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"postcode/backend/internal/domain"
)

type OutboxRepository interface {
	FetchPendingNotifications(ctx context.Context, limit int, now time.Time) ([]domain.NotificationOutboxItem, error)
	MarkNotificationSent(ctx context.Context, id string, sentAt time.Time) error
	MarkNotificationFailed(ctx context.Context, id string, errStr string, nextAttempt time.Time, final bool) error
	ListNotificationOutbox(ctx context.Context, limit, offset int, status string) ([]domain.NotificationOutboxItem, int, error)
}

type WorkerConfig struct {
	PollInterval   time.Duration
	InitialBackoff time.Duration
	MaxAttempts    int
	BatchSize      int
}

func DefaultWorkerConfig() WorkerConfig {
	return WorkerConfig{
		PollInterval:   1 * time.Second,
		InitialBackoff: 1 * time.Second,
		MaxAttempts:    3,
		BatchSize:      10,
	}
}

type OutboxWorker struct {
	repo    OutboxRepository
	sender  NotificationSender
	logger  *slog.Logger
	cfg     WorkerConfig
	mu      sync.Mutex
	running bool
}

func NewOutboxWorker(repo OutboxRepository, sender NotificationSender, logger *slog.Logger, cfg WorkerConfig) *OutboxWorker {
	if logger == nil {
		logger = slog.Default()
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 1 * time.Second
	}
	if cfg.InitialBackoff <= 0 {
		cfg.InitialBackoff = 1 * time.Second
	}
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 3
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 10
	}
	return &OutboxWorker{
		repo:   repo,
		sender: sender,
		logger: logger,
		cfg:    cfg,
	}
}

// ProcessOnce processes a single batch of pending notifications synchronously.
// Returns the number of processed notifications and any fetch error.
func (w *OutboxWorker) ProcessOnce(ctx context.Context) (int, error) {
	now := time.Now().UTC()
	items, err := w.repo.FetchPendingNotifications(ctx, w.cfg.BatchSize, now)
	if err != nil {
		return 0, err
	}
	if len(items) == 0 {
		return 0, nil
	}

	processed := 0
	for _, item := range items {
		select {
		case <-ctx.Done():
			return processed, ctx.Err()
		default:
		}

		var msg domain.NotificationMessage
		if err := json.Unmarshal([]byte(item.Payload), &msg); err != nil {
			// If payload cannot be unmarshaled, create minimal message from outbox item
			msg = domain.NotificationMessage{
				ID:        item.ID,
				TicketID:  item.TicketID,
				BranchID:  item.BranchID,
				EventType: item.EventType,
				CreatedAt: item.CreatedAt,
			}
		}
		if msg.ID == "" {
			msg.ID = item.ID
		}
		// Appointment payloads intentionally carry business metadata only; delivery
		// routing remains in protected outbox columns and must survive reconstruction.
		if msg.Channel == "" {
			msg.Channel = item.Channel
		}
		if msg.Destination == "" {
			msg.Destination = item.Destination
		}
		if (item.EventType == domain.NotificationAppointmentConfirmation || item.EventType == domain.NotificationAppointmentReminder) && msg.Body == "" {
			// Appointment metadata is stored in the outbox payload, not in logs.
			msg.Body = item.Payload
		}

		start := time.Now()
		sendErr := w.sender.Send(ctx, msg)
		duration := time.Since(start)

		if sendErr == nil {
			sentAt := time.Now().UTC()
			if err := w.repo.MarkNotificationSent(ctx, item.ID, sentAt); err != nil {
				w.logger.Error("failed to mark notification as sent",
					"notification_id", item.ID,
					"error", err.Error(),
				)
			} else {
				w.logger.Info("notification sent successfully",
					"notification_id", item.ID,
					"ticket_id", item.TicketID,
					"event_type", item.EventType,
					"attempt", item.Attempts+1,
					"duration_ms", duration.Milliseconds(),
				)
			}
		} else {
			newAttempts := item.Attempts + 1
			maxAttempts := item.MaxAttempts
			if maxAttempts <= 0 {
				maxAttempts = w.cfg.MaxAttempts
			}
			isFinal := newAttempts >= maxAttempts || IsPermanent(sendErr)

			// Exponential backoff: initial * 2^(attempts-1)
			backoffMultiplier := 1 << (newAttempts - 1)
			if backoffMultiplier > 16 {
				backoffMultiplier = 16
			}
			nextAttempt := time.Now().UTC().Add(time.Duration(backoffMultiplier) * w.cfg.InitialBackoff)

			if err := w.repo.MarkNotificationFailed(ctx, item.ID, sendErr.Error(), nextAttempt, isFinal); err != nil {
				w.logger.Error("failed to mark notification as failed",
					"notification_id", item.ID,
					"error", err.Error(),
				)
			} else {
				if isFinal && item.SubscriptionID != nil && (item.Channel == domain.NotificationChannelWebPush || item.Channel == domain.NotificationChannelTelegram) {
					if subscriptions, ok := w.repo.(interface {
						DisableSubscriptionByID(context.Context, string) error
					}); ok {
						_ = subscriptions.DisableSubscriptionByID(ctx, *item.SubscriptionID)
					}
				}
				logLevel := slog.LevelWarn
				resultStr := "RETRYING"
				if isFinal {
					logLevel = slog.LevelError
					resultStr = "FAILED"
				}
				w.logger.Log(ctx, logLevel, "notification delivery failed",
					"notification_id", item.ID,
					"ticket_id", item.TicketID,
					"event_type", item.EventType,
					"attempt", newAttempts,
					"max_attempts", maxAttempts,
					"result", resultStr,
					"next_attempt_at", nextAttempt,
					"duration_ms", duration.Milliseconds(),
					"error", sendErr.Error(),
				)
			}
		}
		processed++
	}
	return processed, nil
}

// Start launches the background polling loop.
func (w *OutboxWorker) Start(ctx context.Context) {
	w.mu.Lock()
	if w.running {
		w.mu.Unlock()
		return
	}
	w.running = true
	w.mu.Unlock()

	ticker := time.NewTicker(w.cfg.PollInterval)
	defer ticker.Stop()

	w.logger.Info("notification outbox worker started",
		"poll_interval", w.cfg.PollInterval,
		"max_attempts", w.cfg.MaxAttempts,
	)

	for {
		select {
		case <-ctx.Done():
			w.logger.Info("notification outbox worker stopping")
			return
		case <-ticker.C:
			pollCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			_, err := w.ProcessOnce(pollCtx)
			cancel()
			if err != nil && !errors.Is(err, context.Canceled) {
				w.logger.Warn("outbox worker cycle error", "error", err.Error())
			}
		}
	}
}

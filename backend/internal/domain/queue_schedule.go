package domain

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

type WindowClosePolicy string

const (
	WindowCloseFinishCurrent WindowClosePolicy = "finish_current"
	WindowCloseReturnToQueue WindowClosePolicy = "return_to_queue"
)

type AppointmentPolicy struct {
	GraceMinutes         int `yaml:"grace_minutes"`
	EarlyWindowMinutes   int `yaml:"early_window_minutes"`
	LatePenaltyPerMinute int `yaml:"late_penalty_per_minute,omitempty"`
	LatePenaltyMaxPoints int `yaml:"late_penalty_max_points,omitempty"`
}

type SourcePolicy struct {
	Rank           int  `yaml:"rank"`
	MaxWaitMinutes *int `yaml:"max_wait_minutes,omitempty"`
}

type ServicePolicy struct {
	MaxWaitMinutes int `yaml:"max_wait_minutes"`
}

type CallPolicy struct {
	ClientTimeoutSeconds int `yaml:"client_timeout_seconds"`
	MaxRecalls           int `yaml:"max_recalls"`
}

type WindowCloseConfig struct {
	Policy WindowClosePolicy `yaml:"policy"`
}

type AlertsPolicy struct {
	OverdueAfterMinutes int `yaml:"overdue_after_minutes"`
}

type MLEtaPolicy struct {
	Enabled                   bool   `yaml:"enabled"`
	URL                       string `yaml:"url,omitempty"`
	TimeoutMilliseconds       int    `yaml:"timeout_ms"`
	CircuitBreakerThreshold   int    `yaml:"circuit_breaker_threshold"`
	CircuitBreakerCooldownSec int    `yaml:"circuit_breaker_cooldown_seconds"`
	CacheTTLSeconds           int    `yaml:"cache_ttl_seconds"`
}

type MLPolicy struct {
	ETA    MLEtaPolicy `yaml:"eta"`
	NoShow struct {
		Enabled          bool `yaml:"enabled"`
		MaxAbsAdjustment int  `yaml:"max_abs_adjustment"`
	} `yaml:"noshow"`
}

type QueuePolicyConfig struct {
	PolicyVersion int64                    `yaml:"policy_version"`
	Appointment   AppointmentPolicy        `yaml:"appointment"`
	Sources       map[string]SourcePolicy  `yaml:"sources"`
	Services      map[string]ServicePolicy `yaml:"services"`
	Call          CallPolicy               `yaml:"call"`
	WindowClose   WindowCloseConfig        `yaml:"window_close"`
	Alerts        AlertsPolicy             `yaml:"alerts"`
	ML            MLPolicy                 `yaml:"ml"`
}

func (c *QueuePolicyConfig) Validate() error {
	if c.PolicyVersion <= 0 {
		return errors.New("policy_version must be positive")
	}
	if c.Appointment.GraceMinutes <= 0 {
		return errors.New("appointment.grace_minutes must be positive")
	}
	if c.Appointment.EarlyWindowMinutes <= 0 {
		return errors.New("appointment.early_window_minutes must be positive")
	}
	if len(c.Sources) == 0 {
		return errors.New("sources must not be empty")
	}
	for src, sp := range c.Sources {
		if sp.Rank < 0 {
			return fmt.Errorf("source %s rank must be non-negative", src)
		}
		if sp.MaxWaitMinutes != nil && *sp.MaxWaitMinutes <= 0 {
			return fmt.Errorf("source %s max_wait_minutes must be positive", src)
		}
	}
	for svc, srv := range c.Services {
		if srv.MaxWaitMinutes <= 0 {
			return fmt.Errorf("service %s max_wait_minutes must be positive", svc)
		}
	}
	if c.Call.ClientTimeoutSeconds <= 0 {
		return errors.New("call.client_timeout_seconds must be positive")
	}
	if c.Call.MaxRecalls <= 0 {
		return errors.New("call.max_recalls must be positive")
	}
	switch c.WindowClose.Policy {
	case WindowCloseFinishCurrent, WindowCloseReturnToQueue:
		// valid
	default:
		return fmt.Errorf("window_close.policy must be 'finish_current' or 'return_to_queue', got: %s", c.WindowClose.Policy)
	}
	if c.Alerts.OverdueAfterMinutes <= 0 {
		return errors.New("alerts.overdue_after_minutes must be positive")
	}
	if c.ML.ETA.TimeoutMilliseconds <= 0 {
		c.ML.ETA.TimeoutMilliseconds = 300
	}
	if c.ML.ETA.CircuitBreakerThreshold <= 0 {
		c.ML.ETA.CircuitBreakerThreshold = 3
	}
	if c.ML.ETA.CircuitBreakerCooldownSec <= 0 {
		c.ML.ETA.CircuitBreakerCooldownSec = 10
	}
	if c.ML.ETA.CacheTTLSeconds <= 0 {
		c.ML.ETA.CacheTTLSeconds = 5
	}
	return nil
}

func LoadQueuePolicy(r io.Reader) (QueuePolicyConfig, error) {
	var cfg QueuePolicyConfig
	dec := yaml.NewDecoder(r)
	dec.KnownFields(true) // error on unknown fields
	if err := dec.Decode(&cfg); err != nil {
		return cfg, fmt.Errorf("failed to decode queue policy YAML: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return cfg, fmt.Errorf("queue policy validation error: %w", err)
	}
	return cfg, nil
}

func LoadQueuePolicyFile(path string) (QueuePolicyConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return QueuePolicyConfig{}, err
	}
	return LoadQueuePolicy(bytes.NewReader(data))
}

type ScheduleTicketInput struct {
	Source      TicketSource
	ScheduledAt *time.Time
	ServiceID   string
	IsRequeued  bool
}

// ComputeSchedule is a pure function that calculates due_at, ready_at and source_rank.
// No DB access and no time.Now inside!
func ComputeSchedule(policy QueuePolicyConfig, ticket ScheduleTicketInput, checkinAt time.Time) (dueAt time.Time, readyAt time.Time, sourceRank int) {
	getMaxWait := func(srcKey string) time.Duration {
		maxWait := 30 * time.Minute
		svcKey := strings.ToLower(ticket.ServiceID)
		if srv, ok := policy.Services[ticket.ServiceID]; ok && srv.MaxWaitMinutes > 0 {
			maxWait = time.Duration(srv.MaxWaitMinutes) * time.Minute
		} else if srv, ok := policy.Services[svcKey]; ok && srv.MaxWaitMinutes > 0 {
			maxWait = time.Duration(srv.MaxWaitMinutes) * time.Minute
		}

		if sp, ok := policy.Sources[srcKey]; ok && sp.MaxWaitMinutes != nil && *sp.MaxWaitMinutes >= 0 {
			starveWait := time.Duration(*sp.MaxWaitMinutes) * time.Minute
			if starveWait < maxWait {
				maxWait = starveWait
			}
		}
		return maxWait
	}

	srcLower := strings.ToLower(string(ticket.Source))

	switch ticket.Source {
	case TicketSourceAppointment:
		aptRank := 0
		if sp, ok := policy.Sources["appointment"]; ok {
			aptRank = sp.Rank
		}
		liveRank := 2
		if sp, ok := policy.Sources["live"]; ok {
			liveRank = sp.Rank
		}

		if ticket.IsRequeued {
			maxWait := getMaxWait("appointment")
			checkin := checkinAt.UTC()
			dueAt = checkin.Add(maxWait)
			readyAt = checkin
			sourceRank = aptRank
			return dueAt.UTC(), readyAt.UTC(), sourceRank
		}

		slot := time.Time{}
		if ticket.ScheduledAt != nil {
			slot = ticket.ScheduledAt.UTC()
		}
		grace := time.Duration(policy.Appointment.GraceMinutes) * time.Minute
		earlyWindow := time.Duration(policy.Appointment.EarlyWindowMinutes) * time.Minute

		if checkinAt.IsZero() {
			// Not checked in yet: eligible exactly at scheduled slot time
			dueAt = slot
			readyAt = slot
			sourceRank = aptRank
			return dueAt, readyAt, sourceRank
		}

		checkin := checkinAt.UTC()
		earliestCall := slot.Add(-earlyWindow)
		latestCall := slot.Add(grace)

		if checkin.Before(earliestCall) {
			// APPOINTMENT, пришёл раньше допустимого 15-минутного окна:
			// Клиент уже в отделении (нажал кнопку), поэтому ready_at = checkin.
			// Однако приоритет онлайн-записи перед живой очередью пропадает (становится в живую очередь):
			maxWait := getMaxWait("live")
			dueAt = checkin.Add(maxWait)
			readyAt = checkin
			sourceRank = liveRank
		} else if !checkin.After(latestCall) {
			// APPOINTMENT, пришёл вовремя (в окне [slot - earlyWindow, slot + grace]):
			// Сохраняет приоритет предварительной записи, готов к вызову сразу по прибытии.
			dueAt = slot
			readyAt = checkin
			sourceRank = aptRank
		} else {
			// APPOINTMENT, опоздал свыше 30 минут (checkin > slot + grace):
			// Приоритет пропадает, талон становится в живую очередь с возможным пенальти:
			maxWait := getMaxWait("live")
			penalty := time.Duration(0)
			if policy.Appointment.LatePenaltyPerMinute > 0 {
				lateMinutes := int(checkin.Sub(latestCall).Minutes())
				if lateMinutes > 0 {
					pts := lateMinutes * policy.Appointment.LatePenaltyPerMinute
					if policy.Appointment.LatePenaltyMaxPoints > 0 && pts > policy.Appointment.LatePenaltyMaxPoints {
						pts = policy.Appointment.LatePenaltyMaxPoints
					}
					penalty = time.Duration(pts) * time.Minute
				}
			}
			dueAt = checkin.Add(maxWait + penalty)
			readyAt = checkin
			sourceRank = liveRank
		}

	case TicketSourceQR:
		qrRank := 1
		if sp, ok := policy.Sources["qr"]; ok {
			qrRank = sp.Rank
		}
		sourceRank = qrRank

		if checkinAt.IsZero() {
			// До check-in талон не вызывается
			readyAt = time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC)
			dueAt = readyAt
			return dueAt, readyAt, sourceRank
		}
		checkin := checkinAt.UTC()
		maxWait := getMaxWait("qr")
		dueAt = checkin.Add(maxWait)
		readyAt = checkin

	case TicketSourceLive:
		liveRank := 2
		if sp, ok := policy.Sources["live"]; ok {
			liveRank = sp.Rank
		}
		sourceRank = liveRank

		checkin := checkinAt.UTC()
		maxWait := getMaxWait("live")
		dueAt = checkin.Add(maxWait)
		readyAt = checkin

	default:
		sourceRank = 99
		if sp, ok := policy.Sources[srcLower]; ok {
			sourceRank = sp.Rank
		}
		checkin := checkinAt.UTC()
		maxWait := getMaxWait(srcLower)
		dueAt = checkin.Add(maxWait)
		readyAt = checkin
	}

	return dueAt.UTC(), readyAt.UTC(), sourceRank
}

func DefaultQueuePolicy() QueuePolicyConfig {
	maxWait30 := 30
	return QueuePolicyConfig{
		PolicyVersion: 1,
		Appointment: AppointmentPolicy{
			GraceMinutes:       15,
			EarlyWindowMinutes: 10,
		},
		Sources: map[string]SourcePolicy{
			"appointment": {Rank: 0},
			"qr":          {Rank: 1, MaxWaitMinutes: &maxWait30},
			"live":        {Rank: 2, MaxWaitMinutes: &maxWait30},
		},
		Services: map[string]ServicePolicy{
			"letters":                              {MaxWaitMinutes: 20},
			"parcels":                              {MaxWaitMinutes: 30},
			"payments":                             {MaxWaitMinutes: 15},
			"send":                                 {MaxWaitMinutes: 30},
			"retail":                               {MaxWaitMinutes: 15},
			"22222222-2222-2222-2222-222222222222": {MaxWaitMinutes: 30}, // Parcels
			"55555555-5555-5555-5555-555555555555": {MaxWaitMinutes: 15}, // Payments
			"33333333-2222-2222-2222-222222222222": {MaxWaitMinutes: 30}, // Send
			"44444444-2222-2222-2222-222222222222": {MaxWaitMinutes: 15}, // Retail
		},
		Call: CallPolicy{
			ClientTimeoutSeconds: 90,
			MaxRecalls:           2,
		},
		WindowClose: WindowCloseConfig{
			Policy: WindowCloseFinishCurrent,
		},
		Alerts: AlertsPolicy{
			OverdueAfterMinutes: 15,
		},
		ML: MLPolicy{ETA: MLEtaPolicy{Enabled: false, TimeoutMilliseconds: 300, CircuitBreakerThreshold: 3, CircuitBreakerCooldownSec: 10, CacheTTLSeconds: 5}},
	}
}

type contextKey string

const RequestIDKey contextKey = "request_id"

func WithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, RequestIDKey, requestID)
}

func RequestIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v, ok := ctx.Value(RequestIDKey).(string); ok {
		return v
	}
	if v, ok := ctx.Value("request_id").(string); ok {
		return v
	}
	return ""
}

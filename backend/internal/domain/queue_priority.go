package domain

import "time"

// QueueTier is ordered from highest to lowest priority.
type QueueTier int

const (
	QueueTierIneligible  QueueTier = -1
	QueueTierAppointment QueueTier = 0
	QueueTierQR          QueueTier = 1
	QueueTierLive        QueueTier = 2
)

type QueuePriorityInput struct {
	Source                   TicketSource
	ScheduledAt              *time.Time
	ArrivedAt                *time.Time
	CheckinAt                *time.Time
	QueueEnteredAt           time.Time
	RequeuedAt               *time.Time
	DecisionAt               time.Time
	PromotionIntervalMinutes int
	AppointmentGraceMinutes  int
}

type QueuePriority struct {
	Tier      QueueTier
	EnteredAt time.Time
}

// EffectiveQueuePriority returns the tier and the instant the ticket entered it.
// A normal appointment is ineligible before its slot. Early check-in irrevocably
// uses the LIVE path, and requeue starts a new cycle without changing that path.
func EffectiveQueuePriority(input QueuePriorityInput) QueuePriority {
	interval := time.Duration(input.PromotionIntervalMinutes) * time.Minute
	cycleStart := input.QueueEnteredAt
	if cycleStart.IsZero() && input.CheckinAt != nil {
		cycleStart = *input.CheckinAt
	}
	if input.RequeuedAt != nil {
		cycleStart = *input.RequeuedAt
	}

	earlyArrival := input.CheckinAt
	if input.ArrivedAt != nil {
		earlyArrival = input.ArrivedAt
	}
	isEarlyAppointment := input.Source == TicketSourceAppointment && input.ScheduledAt != nil &&
		earlyArrival != nil && earlyArrival.Before(*input.ScheduledAt)
	if isEarlyAppointment && input.RequeuedAt == nil {
		cycleStart = *earlyArrival
		if input.CheckinAt != nil {
			cycleStart = *input.CheckinAt
		}
	}

	if input.Source == TicketSourceAppointment && input.ScheduledAt != nil && !isEarlyAppointment {
		start := *input.ScheduledAt
		if input.RequeuedAt != nil && input.RequeuedAt.After(start) {
			start = *input.RequeuedAt
		}
		if input.DecisionAt.Before(start) {
			return QueuePriority{Tier: QueueTierIneligible}
		}
		graceEnd := start.Add(time.Duration(input.AppointmentGraceMinutes) * time.Minute)
		if input.DecisionAt.Before(graceEnd) {
			return QueuePriority{Tier: QueueTierAppointment, EnteredAt: start}
		}
		promotionAt := graceEnd.Add(interval)
		if input.DecisionAt.Before(promotionAt) {
			return QueuePriority{Tier: QueueTierQR, EnteredAt: graceEnd}
		}
		return QueuePriority{Tier: QueueTierAppointment, EnteredAt: promotionAt}
	}

	if input.Source == TicketSourceQR {
		promotionAt := cycleStart.Add(interval)
		if input.DecisionAt.Before(promotionAt) {
			return QueuePriority{Tier: QueueTierQR, EnteredAt: cycleStart}
		}
		return QueuePriority{Tier: QueueTierAppointment, EnteredAt: promotionAt}
	}

	if input.Source == TicketSourceLive || input.Source == TicketSourceAppointment {
		firstPromotion := cycleStart.Add(interval)
		if input.DecisionAt.Before(firstPromotion) {
			return QueuePriority{Tier: QueueTierLive, EnteredAt: cycleStart}
		}
		secondPromotion := firstPromotion.Add(interval)
		if input.DecisionAt.Before(secondPromotion) {
			return QueuePriority{Tier: QueueTierQR, EnteredAt: firstPromotion}
		}
		return QueuePriority{Tier: QueueTierAppointment, EnteredAt: secondPromotion}
	}

	return QueuePriority{Tier: QueueTierIneligible}
}

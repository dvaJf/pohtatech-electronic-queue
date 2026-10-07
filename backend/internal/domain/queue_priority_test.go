package domain

import (
	"testing"
	"time"
)

func TestEffectiveQueuePriority(t *testing.T) {
	base := time.Date(2026, time.October, 7, 10, 0, 0, 0, time.UTC)
	at := func(offset time.Duration) time.Time { return base.Add(offset) }
	ptr := func(value time.Time) *time.Time { return &value }
	minute := time.Minute
	before := time.Nanosecond

	tests := []struct {
		name  string
		input QueuePriorityInput
		want  QueuePriority
	}{
		{
			name:  "appointment before slot is ineligible",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), DecisionAt: at(-before)},
			want:  QueuePriority{Tier: QueueTierIneligible},
		},
		{
			name:  "appointment enters at its slot",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), DecisionAt: base},
			want:  QueuePriority{Tier: QueueTierAppointment, EnteredAt: base},
		},
		{
			name:  "appointment remains first tier before grace ends",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), DecisionAt: at(5*minute - before)},
			want:  QueuePriority{Tier: QueueTierAppointment, EnteredAt: base},
		},
		{
			name:  "appointment enters QR exactly at grace boundary",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), DecisionAt: at(5 * minute)},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: at(5 * minute)},
		},
		{
			name:  "appointment remains QR before re-promotion",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), DecisionAt: at(15*minute - before)},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: at(5 * minute)},
		},
		{
			name:  "appointment re-promotes exactly one interval after grace",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), DecisionAt: at(15 * minute)},
			want:  QueuePriority{Tier: QueueTierAppointment, EnteredAt: at(15 * minute)},
		},
		{
			name:  "ordinary check-in after slot does not reset appointment aging",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), CheckinAt: ptr(at(2 * minute)), DecisionAt: at(6 * minute)},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: at(5 * minute)},
		},
		{
			name:  "check-in exactly at slot retains appointment path",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), CheckinAt: ptr(base), DecisionAt: at(6 * minute)},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: at(5 * minute)},
		},
		{
			name:  "QR starts in QR",
			input: QueuePriorityInput{Source: TicketSourceQR, QueueEnteredAt: base, DecisionAt: base},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: base},
		},
		{
			name:  "QR remains QR before promotion",
			input: QueuePriorityInput{Source: TicketSourceQR, QueueEnteredAt: base, DecisionAt: at(10*minute - before)},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: base},
		},
		{
			name:  "QR promotes exactly at interval",
			input: QueuePriorityInput{Source: TicketSourceQR, QueueEnteredAt: base, DecisionAt: at(10 * minute)},
			want:  QueuePriority{Tier: QueueTierAppointment, EnteredAt: at(10 * minute)},
		},
		{
			name:  "QR uses fifteen minute interval",
			input: QueuePriorityInput{Source: TicketSourceQR, QueueEnteredAt: base, DecisionAt: at(15 * minute), PromotionIntervalMinutes: 15},
			want:  QueuePriority{Tier: QueueTierAppointment, EnteredAt: at(15 * minute)},
		},
		{
			name:  "LIVE starts in LIVE",
			input: QueuePriorityInput{Source: TicketSourceLive, QueueEnteredAt: base, DecisionAt: base},
			want:  QueuePriority{Tier: QueueTierLive, EnteredAt: base},
		},
		{
			name:  "LIVE remains LIVE before first promotion",
			input: QueuePriorityInput{Source: TicketSourceLive, QueueEnteredAt: base, DecisionAt: at(10*minute - before)},
			want:  QueuePriority{Tier: QueueTierLive, EnteredAt: base},
		},
		{
			name:  "LIVE enters QR exactly at first interval",
			input: QueuePriorityInput{Source: TicketSourceLive, QueueEnteredAt: base, DecisionAt: at(10 * minute)},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: at(10 * minute)},
		},
		{
			name:  "LIVE remains QR before second promotion",
			input: QueuePriorityInput{Source: TicketSourceLive, QueueEnteredAt: base, DecisionAt: at(20*minute - before)},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: at(10 * minute)},
		},
		{
			name:  "LIVE enters appointment tier exactly at second interval",
			input: QueuePriorityInput{Source: TicketSourceLive, QueueEnteredAt: base, DecisionAt: at(20 * minute)},
			want:  QueuePriority{Tier: QueueTierAppointment, EnteredAt: at(20 * minute)},
		},
		{
			name:  "LIVE uses twenty minute interval for both promotions",
			input: QueuePriorityInput{Source: TicketSourceLive, QueueEnteredAt: base, DecisionAt: at(40 * minute), PromotionIntervalMinutes: 20},
			want:  QueuePriority{Tier: QueueTierAppointment, EnteredAt: at(40 * minute)},
		},
		{
			name:  "early appointment follows LIVE after its slot",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), CheckinAt: ptr(at(-5 * minute)), QueueEnteredAt: base, DecisionAt: at(6 * minute)},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: at(5 * minute)},
		},
		{
			name:  "early appointment reaches top tier through LIVE aging",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), CheckinAt: ptr(at(-5 * minute)), QueueEnteredAt: base, DecisionAt: at(15 * minute)},
			want:  QueuePriority{Tier: QueueTierAppointment, EnteredAt: at(15 * minute)},
		},
		{
			name:  "QR requeue starts a fresh QR cycle",
			input: QueuePriorityInput{Source: TicketSourceQR, QueueEnteredAt: at(-30 * minute), RequeuedAt: ptr(base), DecisionAt: at(5 * minute)},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: base},
		},
		{
			name:  "LIVE requeue starts a fresh LIVE cycle",
			input: QueuePriorityInput{Source: TicketSourceLive, QueueEnteredAt: at(-30 * minute), RequeuedAt: ptr(base), DecisionAt: at(12 * minute)},
			want:  QueuePriority{Tier: QueueTierQR, EnteredAt: at(10 * minute)},
		},
		{
			name:  "appointment requeue keeps appointment path and restarts grace",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(at(-30 * minute)), RequeuedAt: ptr(base), DecisionAt: at(4 * minute)},
			want:  QueuePriority{Tier: QueueTierAppointment, EnteredAt: base},
		},
		{
			name:  "early appointment requeue keeps LIVE path",
			input: QueuePriorityInput{Source: TicketSourceAppointment, ScheduledAt: ptr(base), ArrivedAt: ptr(at(-5 * minute)), CheckinAt: ptr(at(8 * minute)), QueueEnteredAt: base, RequeuedAt: ptr(at(8 * minute)), DecisionAt: at(10 * minute)},
			want:  QueuePriority{Tier: QueueTierLive, EnteredAt: at(8 * minute)},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			input := tc.input
			if input.PromotionIntervalMinutes == 0 {
				input.PromotionIntervalMinutes = 10
			}
			input.AppointmentGraceMinutes = 5
			got := EffectiveQueuePriority(input)
			if got.Tier != tc.want.Tier || !got.EnteredAt.Equal(tc.want.EnteredAt) {
				t.Errorf("EffectiveQueuePriority(%+v) = %+v, want %+v", input, got, tc.want)
			}
		})
	}
}

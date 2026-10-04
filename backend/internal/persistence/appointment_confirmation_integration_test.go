package persistence

import (
	"errors"
	"testing"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func TestAppointmentConfirmationLifecycle(t *testing.T) {
	ctx, p, _ := integration(t)

	t.Run("code confirmation transitions to SCHEDULED and is idempotent", func(t *testing.T) {
		slot := time.Now().UTC().Add(45 * time.Minute).Truncate(time.Minute)
		res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
			BranchID:          demoBranch,
			ServiceID:         parcels,
			IdempotencyKey:    "conf-code-lifecycle-1",
			ScheduledAt:       slot,
			NotificationEmail: "client@test.pochta.ru",
		})
		if err != nil {
			t.Fatalf("create appointment: %v", err)
		}

		ticket := res.Appointment.Ticket
		if ticket.Status != domain.TicketStatusPendingConfirmation {
			t.Fatalf("expected PENDING_CONFIRMATION, got %s", ticket.Status)
		}
		if ticket.ConfirmationCode == nil || *ticket.ConfirmationCode == "" {
			t.Fatalf("expected non-empty ConfirmationCode")
		}

		// 1. Confirm using the code
		confirmed, err := p.ConfirmAppointment(ctx, ticket.ID, *ticket.ConfirmationCode)
		if err != nil {
			t.Fatalf("confirm appointment by code failed: %v", err)
		}
		if confirmed.Ticket.Status != domain.TicketStatusScheduled {
			t.Fatalf("expected SCHEDULED, got %s", confirmed.Ticket.Status)
		}
		if confirmed.Ticket.ConfirmedAt == nil {
			t.Fatalf("expected non-nil ConfirmedAt")
		}

		// 2. Idempotent repeat: confirming again returns SCHEDULED without error
		idempotent, err := p.ConfirmAppointment(ctx, ticket.ID, *ticket.ConfirmationCode)
		if err != nil {
			t.Fatalf("idempotent confirmation should not fail: %v", err)
		}
		if idempotent.Ticket.Status != domain.TicketStatusScheduled {
			t.Fatalf("expected SCHEDULED on repeat confirm, got %s", idempotent.Ticket.Status)
		}
	})

	t.Run("one-click token confirmation without ticketId in path", func(t *testing.T) {
		slot := time.Now().UTC().Add(60 * time.Minute).Truncate(time.Minute)
		res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
			BranchID:          demoBranch,
			ServiceID:         parcels,
			IdempotencyKey:    "conf-token-1click-1",
			ScheduledAt:       slot,
			NotificationEmail: "client2@test.pochta.ru",
		})
		if err != nil {
			t.Fatalf("create appointment: %v", err)
		}

		rawToken := res.Appointment.Ticket.ConfirmationTokenHash
		if rawToken == nil || *rawToken == "" {
			t.Fatalf("expected raw token in in-memory ticket result")
		}

		// Confirm with token without ticketID (using token hash lookup)
		confirmed, err := p.ConfirmAppointment(ctx, "", *rawToken)
		if err != nil {
			t.Fatalf("confirm appointment by raw token failed: %v", err)
		}
		if confirmed.Ticket.Status != domain.TicketStatusScheduled {
			t.Fatalf("expected SCHEDULED, got %s", confirmed.Ticket.Status)
		}
		if confirmed.Ticket.ID != res.Appointment.Ticket.ID {
			t.Fatalf("expected ticket ID %s, got %s", res.Appointment.Ticket.ID, confirmed.Ticket.ID)
		}
	})

	t.Run("cancellation of pending confirmation appointment", func(t *testing.T) {
		slot := time.Now().UTC().Add(75 * time.Minute).Truncate(time.Minute)
		res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
			BranchID:          demoBranch,
			ServiceID:         parcels,
			IdempotencyKey:    "conf-cancel-pending-1",
			ScheduledAt:       slot,
			NotificationEmail: "cancelme@test.pochta.ru",
		})
		if err != nil {
			t.Fatalf("create appointment: %v", err)
		}

		tID := res.Appointment.Ticket.ID
		token := *res.Appointment.Ticket.ManagementToken

		// Cancel via CancelTicket
		cancelled, err := p.CancelTicket(WithManagementToken(ctx, token), tID)
		if err != nil {
			t.Fatalf("cancel pending ticket failed: %v", err)
		}
		if cancelled.Status != domain.TicketStatusCancelled {
			t.Fatalf("expected CANCELLED, got %s", cancelled.Status)
		}
	})

	t.Run("force test confirm transitions pending to scheduled", func(t *testing.T) {
		slot := time.Now().UTC().Add(90 * time.Minute).Truncate(time.Minute)
		res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
			BranchID:          demoBranch,
			ServiceID:         parcels,
			IdempotencyKey:    "conf-test-force-1",
			ScheduledAt:       slot,
			NotificationEmail: "forceme@test.pochta.ru",
		})
		if err != nil {
			t.Fatalf("create appointment: %v", err)
		}

		tID := res.Appointment.Ticket.ID
		forced, err := p.ForceConfirmPendingAppointment(ctx, tID)
		if err != nil {
			t.Fatalf("force confirm failed: %v", err)
		}
		if forced.Ticket.Status != domain.TicketStatusScheduled {
			t.Fatalf("expected SCHEDULED, got %s", forced.Ticket.Status)
		}
	})

	t.Run("invalid code returns forbidden", func(t *testing.T) {
		slot := time.Now().UTC().Add(105 * time.Minute).Truncate(time.Minute)
		res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
			BranchID:          demoBranch,
			ServiceID:         parcels,
			IdempotencyKey:    "conf-wrong-code-1",
			ScheduledAt:       slot,
			NotificationEmail: "wrongcode@test.pochta.ru",
		})
		if err != nil {
			t.Fatalf("create appointment: %v", err)
		}

		_, err = p.ConfirmAppointment(ctx, res.Appointment.Ticket.ID, "999999")
		if !errors.Is(err, application.ErrForbidden) {
			t.Fatalf("expected ErrForbidden for wrong code, got: %v", err)
		}
	})
}

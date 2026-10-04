package persistence

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func TestAppointmentConfirmationResendPreservesExpiry(t *testing.T) {
	ctx, p, _ := integration(t)
	res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
		BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "resend-fixed-expiry",
		ScheduledAt: time.Now().UTC().Add(time.Hour), NotificationEmail: "resend@test.pochta.ru",
	})
	if err != nil {
		t.Fatal(err)
	}
	ticket := res.Appointment.Ticket
	originalExpiry := *ticket.ConfirmationExpiresAt

	for i := 0; i < 2; i++ {
		token, code, expiresAt, err := p.ResendAppointmentConfirmation(ctx, ticket.ID)
		if err != nil {
			t.Fatalf("resend %d: %v", i, err)
		}
		if !expiresAt.Equal(originalExpiry) {
			t.Fatalf("resend extended confirmation deadline: got %s, want %s", expiresAt, originalExpiry)
		}
		stored, err := scanTicket(p.pool.QueryRow(ctx, ticketSelect+`WHERE t.id=$1::uuid`, ticket.ID))
		if err != nil {
			t.Fatal(err)
		}
		if stored.ID != ticket.ID || stored.Status != domain.TicketStatusPendingConfirmation || !stored.ScheduledAt.Equal(*ticket.ScheduledAt) || !stored.ConfirmationExpiresAt.Equal(originalExpiry) {
			t.Fatalf("resend changed appointment identity, state, slot or expiry: %+v", stored)
		}
		hash := sha256.Sum256([]byte(token))
		var storedHash string
		if err := p.pool.QueryRow(ctx, `SELECT confirmation_token_hash FROM tickets WHERE id=$1::uuid`, ticket.ID).Scan(&storedHash); err != nil {
			t.Fatal(err)
		}
		if storedHash != hex.EncodeToString(hash[:]) || stored.ConfirmationCode == nil || *stored.ConfirmationCode != code {
			t.Fatal("resend did not persist returned credentials")
		}
		if token == *ticket.ConfirmationTokenHash {
			t.Fatal("resend did not rotate confirmation token")
		}
		if code == *ticket.ConfirmationCode {
			t.Fatal("resend did not rotate confirmation code")
		}
		if _, err := p.ConfirmAppointment(ctx, ticket.ID, *ticket.ConfirmationTokenHash); !errors.Is(err, application.ErrForbidden) {
			t.Fatalf("old confirmation token remains valid: %v", err)
		}
		ticket.ConfirmationTokenHash = &token
		ticket.ConfirmationCode = &code
	}
	confirmed, err := p.ConfirmAppointment(ctx, ticket.ID, *ticket.ConfirmationTokenHash)
	if err != nil || confirmed.Ticket.Status != domain.TicketStatusScheduled {
		t.Fatalf("rotated token cannot confirm same appointment: %+v, %v", confirmed, err)
	}
}

func TestAppointmentConfirmationResendRejectsExpired(t *testing.T) {
	ctx, p, _ := integration(t)
	res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
		BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "resend-expired",
		ScheduledAt: time.Now().UTC().Add(time.Hour), NotificationEmail: "expired@test.pochta.ru",
	})
	if err != nil {
		t.Fatal(err)
	}
	ticket := res.Appointment.Ticket
	expiredAt := time.Now().UTC().Add(-time.Minute).Truncate(time.Microsecond)
	if _, err := p.pool.Exec(ctx, `UPDATE tickets SET confirmation_expires_at=$1 WHERE id=$2::uuid`, expiredAt, ticket.ID); err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := p.ResendAppointmentConfirmation(ctx, ticket.ID); !errors.Is(err, application.ErrInvalidState) {
		t.Fatalf("expired confirmation can be renewed: %v", err)
	}
	stored, err := scanTicket(p.pool.QueryRow(ctx, ticketSelect+`WHERE t.id=$1::uuid`, ticket.ID))
	if err != nil || !stored.ConfirmationExpiresAt.Equal(expiredAt) || *stored.ConfirmationCode != *ticket.ConfirmationCode {
		t.Fatalf("expired resend mutated appointment: %+v, %v", stored, err)
	}
}

func TestCreateAppointmentBookingWindow(t *testing.T) {
	ctx, p, _ := integration(t)
	moscow, err := time.LoadLocation("Europe/Moscow")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().In(moscow)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, moscow)
	for _, tc := range []struct {
		name    string
		at      time.Time
		allowed bool
	}{
		{"yesterday", today.AddDate(0, 0, -1).Add(12 * time.Hour), false},
		{"today", now.Add((24*time.Hour - now.Sub(today)) / 2).Truncate(time.Microsecond), true},
		{"day14", today.AddDate(0, 0, 14).Add(23*time.Hour + 59*time.Minute), true},
		{"day15", today.AddDate(0, 0, 15), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			res, err := p.CreateAppointment(ctx, application.CreateAppointmentCommand{
				BranchID: demoBranch, ServiceID: parcels, IdempotencyKey: "booking-window-" + tc.name, ScheduledAt: tc.at,
			})
			if tc.allowed {
				if err != nil || !res.Appointment.ScheduledAt.Equal(tc.at) {
					t.Fatalf("in-window appointment rejected: %+v, %v", res, err)
				}
			} else {
				if !errors.Is(err, application.ErrInvalidState) {
					t.Fatalf("out-of-window appointment must be rejected, got %+v, %v", res, err)
				}
				var count int
				if err := p.pool.QueryRow(ctx, `SELECT count(*) FROM tickets WHERE idempotency_key=$1`, "booking-window-"+tc.name).Scan(&count); err != nil || count != 0 {
					t.Fatalf("out-of-window creation persisted a ticket: count=%d, err=%v", count, err)
				}
			}
		})
	}
}

func TestAppointmentBookingWindowMoscowCalendarBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, now, scheduled string
		allowed              bool
	}{
		{"yesterday", "2026-10-04T09:00:00+03:00", "2026-10-03T23:59:59+03:00", false},
		{"today", "2026-10-04T09:00:00+03:00", "2026-10-04T23:00:00+03:00", true},
		{"last instant of day14", "2026-10-04T09:00:00+03:00", "2026-10-18T23:59:59.999999999+03:00", true},
		{"first instant of day15", "2026-10-04T09:00:00+03:00", "2026-10-19T00:00:00+03:00", false},
		{"month day14", "2026-10-25T09:00:00+03:00", "2026-11-08T23:59:59+03:00", true},
		{"month day15", "2026-10-25T09:00:00+03:00", "2026-11-09T00:00:00+03:00", false},
		{"year day14", "2026-12-25T09:00:00+03:00", "2027-01-08T23:59:59+03:00", true},
		{"year day15", "2026-12-25T09:00:00+03:00", "2027-01-09T00:00:00+03:00", false},
		{"leap year day14", "2028-02-20T09:00:00+03:00", "2028-03-05T23:59:59+03:00", true},
		{"leap year day15", "2028-02-20T09:00:00+03:00", "2028-03-06T00:00:00+03:00", false},
		{"Moscow today starts before UTC today", "2026-10-04T21:01:00Z", "2026-10-04T21:30:00Z", true},
		{"Moscow yesterday while UTC date is same", "2026-10-04T21:01:00Z", "2026-10-04T20:59:59Z", false},
		{"Moscow day14 before UTC midnight", "2026-10-04T21:01:00Z", "2026-10-18T21:00:00Z", true},
		{"Moscow day15 before UTC midnight", "2026-10-04T20:59:00Z", "2026-10-18T21:00:00Z", false},
		{"request offset cannot widen Moscow window", "2026-10-04T09:00:00+03:00", "2026-10-18T23:00:00-07:00", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			now, err := time.Parse(time.RFC3339Nano, tc.now)
			if err != nil {
				t.Fatal(err)
			}
			scheduled, err := time.Parse(time.RFC3339Nano, tc.scheduled)
			if err != nil {
				t.Fatal(err)
			}
			err = validateAppointmentBookingWindow(scheduled, now)
			if tc.allowed && err != nil {
				t.Fatalf("Moscow in-window calendar date rejected: %v", err)
			}
			if !tc.allowed && !errors.Is(err, application.ErrInvalidState) {
				t.Fatalf("Moscow out-of-window calendar date accepted: %v", err)
			}
		})
	}
}

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

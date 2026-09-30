package voice

import (
	"context"
	"strings"
	"testing"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

type mockVoiceUseCases struct {
	application.UseCases
	branches           []domain.Branch
	services           []domain.Service
	activeTicket       *domain.Ticket
	createdLive        *application.CreateLiveTicketCommand
	createdAppointment *application.CreateAppointmentCommand
	cancelledTicketID  string
}

func (m *mockVoiceUseCases) ListBranches(ctx context.Context) ([]domain.Branch, error) {
	return m.branches, nil
}

func (m *mockVoiceUseCases) ListBranchServices(ctx context.Context, branchID string) ([]domain.Service, error) {
	return m.services, nil
}

func (m *mockVoiceUseCases) GetBranchWorkload(ctx context.Context, branchID string) (domain.BranchWorkload, error) {
	wait := 180
	return domain.BranchWorkload{
		EstimatedWaitSeconds: &wait,
		ActiveWindows:        2,
		CurrentWaiting:       1,
	}, nil
}

func (m *mockVoiceUseCases) GetOrCreateExternalUser(ctx context.Context, provider, externalUserID string) (domain.User, error) {
	return domain.User{
		ID:    "user-uuid-1",
		Email: "alice_user@test.local",
		Role:  domain.RoleClient,
	}, nil
}

func (m *mockVoiceUseCases) FindActiveTicketByClient(ctx context.Context, clientID string) (*domain.Ticket, error) {
	return m.activeTicket, nil
}

func (m *mockVoiceUseCases) CreateLiveTicket(ctx context.Context, cmd application.CreateLiveTicketCommand) (application.CreateLiveTicketResult, error) {
	m.createdLive = &cmd
	return application.CreateLiveTicketResult{
		Ticket: domain.Ticket{
			ID:           "ticket-live-1",
			PublicNumber: "Q-000101",
			Status:       domain.TicketStatusWaiting,
		},
	}, nil
}

func (m *mockVoiceUseCases) CreateAppointment(ctx context.Context, cmd application.CreateAppointmentCommand) (application.CreateAppointmentResult, error) {
	m.createdAppointment = &cmd
	return application.CreateAppointmentResult{
		Appointment: application.AppointmentView{
			Ticket: domain.Ticket{
				ID:           "ticket-apt-1",
				PublicNumber: "A-000202",
				Status:       domain.TicketStatusScheduled,
			},
			ScheduledAt: cmd.ScheduledAt,
		},
	}, nil
}

func (m *mockVoiceUseCases) GetQueuePosition(ctx context.Context, ticketID string) (domain.QueuePosition, error) {
	pos := 2
	return domain.QueuePosition{
		TicketID: ticketID,
		Position: &pos,
	}, nil
}

func (m *mockVoiceUseCases) CancelTicket(ctx context.Context, ticketID string) (domain.Ticket, error) {
	m.cancelledTicketID = ticketID
	return domain.Ticket{ID: ticketID, Status: domain.TicketStatusCancelled}, nil
}

func (m *mockVoiceUseCases) CancelAppointment(ctx context.Context, ticketID string) (application.AppointmentView, error) {
	m.cancelledTicketID = ticketID
	return application.AppointmentView{
		Ticket: domain.Ticket{ID: ticketID, Status: domain.TicketStatusCancelled},
	}, nil
}

func setupTestVoiceService() (*VoiceService, *mockVoiceUseCases) {
	lat := 55.75231
	lng := 37.59842
	mock := &mockVoiceUseCases{
		branches: []domain.Branch{
			{
				ID:        "branch-arbat",
				Name:      "Отделение Новый Арбат",
				Address:   "ул. Новый Арбат, 2",
				Latitude:  &lat,
				Longitude: &lng,
			},
		},
		services: []domain.Service{
			{ID: "srv-parcel", Code: "PARCEL", Name: "Посылки"},
		},
	}
	svc := NewVoiceService(mock, NewMemorySessionStore(), nil)
	return svc, mock
}

func TestVoiceService_TakeTicket_ConfirmationFlow(t *testing.T) {
	svc, _ := setupTestVoiceService()
	ctx := context.Background()

	// 1. Initial request: "Запиши меня на почту"
	resp1, err := svc.HandleRequest(ctx, VoiceRequest{
		SessionID: "sess-1",
		RequestID: "req-1",
		Command:   "запиши меня на почту",
		Intent:    IntentTakeTicket,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(resp1.Text, "предварительная онлайн-запись") {
		t.Errorf("expected prompt for online appointment, got: %s", resp1.Text)
	}
	if len(resp1.Buttons) == 0 {
		t.Errorf("expected suggestion buttons")
	}
}

func TestVoiceService_BookAppointment_SpecificTime(t *testing.T) {
	svc, mock := setupTestVoiceService()
	ctx := context.Background()

	msk := time.FixedZone("MSK", 3*3600)
	scheduledTime := time.Date(2026, 9, 30, 15, 30, 0, 0, msk)

	// 1. Request: "Запиши меня на 15:30"
	resp1, err := svc.HandleRequest(ctx, VoiceRequest{
		SessionID:   "sess-2",
		RequestID:   "req-1",
		Command:     "запиши меня на 15:30",
		Intent:      IntentBookAppointment,
		ScheduledAt: &scheduledTime,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp1.RequiresConfirmation {
		t.Errorf("expected RequiresConfirmation = true")
	}
	if !strings.Contains(resp1.Text, "15:30") || !strings.Contains(resp1.Text, "Подтверждаете?") {
		t.Errorf("unexpected response text: %s", resp1.Text)
	}
	if resp1.PendingAction == nil || resp1.PendingAction.Type != ActionBookAppointment {
		t.Fatalf("expected ActionBookAppointment in PendingAction")
	}

	// 2. User confirms: "Да"
	resp2, err := svc.HandleRequest(ctx, VoiceRequest{
		SessionID:     "sess-2",
		RequestID:     "req-2",
		Command:       "да",
		Intent:        IntentConfirm,
		PendingAction: resp1.PendingAction,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(resp2.Text, "A-000202") || !strings.Contains(resp2.Text, "15:30") {
		t.Errorf("expected appointment confirmation, got: %s", resp2.Text)
	}
	if mock.createdAppointment == nil {
		t.Fatalf("expected CreateAppointment to be called")
	}
	if !mock.createdAppointment.ScheduledAt.Equal(scheduledTime) {
		t.Errorf("got scheduled time %v, want %v", mock.createdAppointment.ScheduledAt, scheduledTime)
	}
}

func TestVoiceService_CancelTicket_Flow(t *testing.T) {
	svc, mock := setupTestVoiceService()
	ctx := context.Background()

	mock.activeTicket = &domain.Ticket{
		ID:           "active-ticket-99",
		PublicNumber: "Q-000999",
		BranchID:     "branch-arbat",
		Status:       domain.TicketStatusWaiting,
	}

	// 1. "Отмени запись"
	resp1, err := svc.HandleRequest(ctx, VoiceRequest{
		SessionID: "sess-3",
		RequestID: "req-1",
		Command:   "отмени запись",
		Intent:    IntentCancelTicket,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !resp1.RequiresConfirmation {
		t.Errorf("expected RequiresConfirmation = true for cancel")
	}
	if !strings.Contains(resp1.Text, "Q-000999") || !strings.Contains(resp1.Text, "отменить запись?") {
		t.Errorf("unexpected text: %s", resp1.Text)
	}

	// 2. User confirms: "Да"
	resp2, err := svc.HandleRequest(ctx, VoiceRequest{
		SessionID:     "sess-3",
		RequestID:     "req-2",
		Command:       "да",
		Intent:        IntentConfirm,
		PendingAction: resp1.PendingAction,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(resp2.Text, "отменён") {
		t.Errorf("expected cancel confirmation, got: %s", resp2.Text)
	}
	if mock.cancelledTicketID != "active-ticket-99" {
		t.Errorf("got cancelled ticket ID %s, want active-ticket-99", mock.cancelledTicketID)
	}
}

func TestVoiceService_ActiveTicketReminder(t *testing.T) {
	svc, mock := setupTestVoiceService()
	ctx := context.Background()

	mock.activeTicket = &domain.Ticket{
		ID:           "existing-1",
		PublicNumber: "Q-000555",
		BranchID:     "branch-arbat",
		Status:       domain.TicketStatusWaiting,
	}

	// User already has a ticket and asks for another
	resp, err := svc.HandleRequest(ctx, VoiceRequest{
		SessionID: "sess-4",
		RequestID: "req-1",
		Command:   "запиши меня на почту",
		Intent:    IntentTakeTicket,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.RequiresConfirmation {
		t.Errorf("should not require confirmation when active ticket already exists")
	}
	if !strings.Contains(resp.Text, "уже есть активный талон Q-000555") {
		t.Errorf("expected active ticket reminder, got: %s", resp.Text)
	}
}

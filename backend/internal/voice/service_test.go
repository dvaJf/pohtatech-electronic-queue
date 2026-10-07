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

func TestVoiceService_BranchClosed_RejectsOutOfHoursAppointment(t *testing.T) {
	innoLat := 55.752176
	innoLng := 48.744474
	mock := &mockVoiceUseCases{
		branches: []domain.Branch{
			{
				ID:        "branch-inno",
				Name:      "Отделение Иннополис 420500",
				Address:   "г. Иннополис, ул. Университетская, д. 7",
				WorkHours: "09:00–18:00",
				Latitude:  &innoLat,
				Longitude: &innoLng,
			},
		},
		services: []domain.Service{
			{ID: "srv-parcel", Code: "PARCEL", Name: "Посылки"},
		},
	}
	svc := NewVoiceService(mock, NewMemorySessionStore(), nil)
	ctx := context.Background()

	msk := time.FixedZone("MSK", 3*3600)
	// 21:00 is outside 09:00–18:00
	outOfHours := time.Date(2026, 10, 4, 21, 0, 0, 0, msk)

	resp, err := svc.HandleRequest(ctx, VoiceRequest{
		SessionID:   "sess-closed-1",
		RequestID:   "req-1",
		Command:     "запиши в иннополис на 21:00",
		Intent:      IntentBookAppointment,
		ScheduledAt: &outOfHours,
		Slots:       map[string]string{"street": "иннополис"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.RequiresConfirmation {
		t.Fatalf("should NOT require confirmation for out of hours appointment")
	}
	if !strings.Contains(resp.Text, "закрыто") || !strings.Contains(resp.Text, "09:00") || !strings.Contains(resp.Text, "18:00") {
		t.Errorf("expected explanation of working hours, got: %s", resp.Text)
	}

	// 14:00 is INSIDE 09:00–18:00
	inHours := time.Date(2026, 10, 4, 14, 0, 0, 0, msk)
	respOk, err := svc.HandleRequest(ctx, VoiceRequest{
		SessionID:   "sess-closed-2",
		RequestID:   "req-2",
		Command:     "запиши в иннополис на 14:00",
		Intent:      IntentBookAppointment,
		ScheduledAt: &inHours,
		Slots:       map[string]string{"street": "иннополис"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !respOk.RequiresConfirmation {
		t.Fatalf("expected confirmation request for valid in-hours appointment")
	}
	if !strings.Contains(respOk.Text, "14:00") || !strings.Contains(respOk.Text, "Иннополис") {
		t.Errorf("unexpected response: %s", respOk.Text)
	}
}

func TestVoiceService_InnopolisLocation_ClampedWalkingDistance(t *testing.T) {
	innoLat := 55.752176
	innoLng := 48.744474
	mock := &mockVoiceUseCases{
		branches: []domain.Branch{
			{
				ID:        "branch-inno",
				Name:      "Отделение Иннополис 420500",
				Address:   "г. Иннополис, ул. Университетская, д. 7",
				WorkHours: "09:00–18:00",
				Latitude:  &innoLat,
				Longitude: &innoLng,
			},
		},
	}
	svc := NewVoiceService(mock, NewMemorySessionStore(), nil)
	ctx := context.Background()

	// Location unknown, but user explicitly asks for Innopolis
	resp, err := svc.HandleRequest(ctx, VoiceRequest{
		SessionID: "sess-loc-1",
		RequestID: "req-1",
		Command:   "запиши меня в иннополисе",
		Intent:    IntentTakeTicket,
		Slots:     map[string]string{"street": "иннополис"},
		Location: &UserLocation{
			Latitude:  55.7558, // Moscow fallback
			Longitude: 37.6173,
			Source:    LocationSourceUnknown,
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Distance should be clamped to reasonable neighborhood walking distance, not 9000+ minutes!
	if strings.Contains(resp.Text, "93") || strings.Contains(resp.Text, "минут)") && strings.Contains(resp.Text, "000") {
		t.Errorf("walking time was not clamped properly: %s", resp.Text)
	}
	if !strings.Contains(resp.Text, "Иннополис") {
		t.Errorf("expected Innopolis branch match, got: %s", resp.Text)
	}
}

func TestParseWorkHours(t *testing.T) {
	openMin, closeMin, openStr, closeStr, ok := ParseWorkHours("09:00–18:00")
	if !ok || openMin != 540 || closeMin != 1080 || openStr != "09:00" || closeStr != "18:00" {
		t.Errorf("failed parsing en-dash work hours: %v, %d, %d, %s, %s", ok, openMin, closeMin, openStr, closeStr)
	}

	openMin2, closeMin2, _, _, ok2 := ParseWorkHours("08:00-20:00")
	if !ok2 || openMin2 != 480 || closeMin2 != 1200 {
		t.Errorf("failed parsing hyphen work hours: %v, %d, %d", ok2, openMin2, closeMin2)
	}

	_, _, _, _, ok3 := ParseWorkHours("invalid")
	if ok3 {
		t.Errorf("expected false on invalid string")
	}
}


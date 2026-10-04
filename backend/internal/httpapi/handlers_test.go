package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

type FakeUseCases struct {
	GetTicketETAFunc       func(context.Context, string) (domain.TicketETA, error)
	ArriveAppointmentFunc  func(context.Context, string) (application.AppointmentView, error)
	MarkNoShowFunc         func(context.Context, string) (domain.Ticket, error)
	GetQueuePositionFunc   func(context.Context, string) (domain.QueuePosition, error)
	ListBranchesFunc       func(ctx context.Context) ([]domain.Branch, error)
	SubmitFeedbackFunc     func(ctx context.Context, ticketID string, rating int, comment string) error
	ListBranchReviewsFunc  func(ctx context.Context, branchID string) ([]domain.RecentFeedback, error)
	ListBranchServicesFunc func(ctx context.Context, branchID string) ([]domain.Service, error)
	ListBranchWindowsFunc  func(ctx context.Context, branchID string) ([]domain.Window, error)
	CreateQRTicketFunc     func(ctx context.Context, cmd application.CreateQRTicketCommand) (application.CreateQRTicketResult, error)
	GetTicketFunc          func(ctx context.Context, ticketID string) (domain.Ticket, error)
	GetCurrentTicketFunc   func(ctx context.Context, windowID string) (*domain.Ticket, error)
	CallNextFunc           func(ctx context.Context, windowID string) (domain.Ticket, error)
	CallSpecificTicketFunc func(ctx context.Context, windowID string, ticketIDOrNumber string) (domain.Ticket, error)
	StartServiceFunc       func(ctx context.Context, ticketID string) (domain.Ticket, error)
	CompleteServiceFunc    func(ctx context.Context, ticketID string) (domain.Ticket, error)

	CreateLiveTicketFunc     func(ctx context.Context, cmd application.CreateLiveTicketCommand) (application.CreateLiveTicketResult, error)
	CreateAppointmentFunc    func(ctx context.Context, cmd application.CreateAppointmentCommand) (application.CreateAppointmentResult, error)
	CancelAppointmentFunc    func(ctx context.Context, ticketID string) (application.AppointmentView, error)
	CancelTicketFunc         func(ctx context.Context, ticketID string) (domain.Ticket, error)
	GetQueuePolicyFunc       func(ctx context.Context, branchID string) (domain.QueuePolicy, error)
	UpdateQueuePolicyFunc    func(ctx context.Context, cmd application.UpdateQueuePolicyCommand) (domain.QueuePolicy, error)
	ListTicketEventsFunc     func(ctx context.Context, ticketID string) ([]domain.TicketEvent, error)
	UpdateWindowServicesFunc func(ctx context.Context, cmd application.UpdateWindowServicesCommand) (domain.Window, error)
	ChangeWindowStatusFunc   func(ctx context.Context, windowID string, status domain.WindowStatus) (domain.Window, error)
	ReturnTicketFunc         func(ctx context.Context, ticketID string) (domain.Ticket, error)
	RedirectTicketFunc       func(ctx context.Context, cmd application.RedirectTicketCommand) (domain.Ticket, error)
	GetAdminOverviewFunc     func(ctx context.Context, branchID string) (domain.AdminBranchOverview, error)
	SavePriorityRulesFunc    func(ctx context.Context, branchID string, rules []domain.PriorityRule) error
	GetBranchWorkloadFunc    func(ctx context.Context, branchID string) (domain.BranchWorkload, error)
	CloseShiftFunc           func(ctx context.Context, branchID string) (domain.ShiftClosureResult, error)
	UpdateBranchScheduleFunc func(ctx context.Context, branchID string, workHours string) (domain.Branch, error)
	SubmitBranchReviewFunc   func(ctx context.Context, branchID string, rating int, comment string) (domain.CreatedReview, error)
	GetAdminReviewsFunc      func(ctx context.Context, filter domain.AdminReviewsFilter) (domain.AdminReviewsResult, error)

	RegisterFunc       func(ctx context.Context, email, password string) (domain.User, error)
	ConfirmEmailFunc   func(ctx context.Context, token string) error
	ConfirmEmailByCodeFunc func(ctx context.Context, email, code string) (domain.Session, domain.User, error)
	ConfirmEmailByTokenFunc func(ctx context.Context, token string) (domain.Session, domain.User, error)
	ResendEmailConfirmationFunc func(ctx context.Context, email string) (string, string, error)
	LoginFunc          func(ctx context.Context, email, password string) (domain.Session, error)
	LoginOAuthFunc     func(ctx context.Context, email string) (domain.Session, error)
	LogoutFunc         func(ctx context.Context, token string) error
	GetSessionUserFunc func(ctx context.Context, token string) (domain.User, error)
	ListUsersFunc      func(ctx context.Context, limit, offset int, search, role string) (domain.UserPage, error)
	ListAnomaliesFunc  func(ctx context.Context, branchID string, limit, offset int) (domain.AnomalyPage, error)
	ChangeUserRoleFunc func(ctx context.Context, userID string, role domain.UserRole) (domain.User, error)
	ReportIncidentFunc func(ctx context.Context, cmd application.ReportIncidentCommand) (domain.OperatorIncident, error)
}

func (f *FakeUseCases) GetTicketETA(ctx context.Context, id string) (domain.TicketETA, error) {
	return f.GetTicketETAFunc(ctx, id)
}

func (f *FakeUseCases) ListNotificationOutbox(ctx context.Context, limit, offset int, status string) ([]domain.NotificationOutboxItem, int, error) {
	return nil, 0, nil
}

func (f *FakeUseCases) ReportIncident(ctx context.Context, cmd application.ReportIncidentCommand) (domain.OperatorIncident, error) {
	if f.ReportIncidentFunc != nil {
		return f.ReportIncidentFunc(ctx, cmd)
	}
	return domain.OperatorIncident{
		ID:          "inc-test-1",
		BranchID:    cmd.BranchID,
		WindowID:    cmd.WindowID,
		OperatorID:  cmd.OperatorID,
		Category:    cmd.Category,
		Description: cmd.Description,
		CreatedAt:   time.Now().UTC(),
	}, nil
}

func (f *FakeUseCases) GetOrCreateExternalUser(ctx context.Context, provider, externalUserID string) (domain.User, error) {
	return domain.User{
		ID:        "00000000-0000-0000-0000-000000000001",
		Email:     provider + "_" + externalUserID + "@alice.yandex.ru",
		Role:      domain.RoleClient,
		Confirmed: true,
	}, nil
}

func (f *FakeUseCases) FindActiveTicketByClient(ctx context.Context, clientID string) (*domain.Ticket, error) {
	return nil, nil
}

func (f *FakeUseCases) ListActiveTicketsByClient(ctx context.Context, clientID string) ([]domain.Ticket, error) {
	return []domain.Ticket{}, nil
}

func (f *FakeUseCases) LinkExternalAccount(ctx context.Context, userID, provider, externalUserID string) error {
	return nil
}

func (f *FakeUseCases) CreateUserTelegramLink(ctx context.Context, userID string) (string, time.Time, error) {
	return "fake-user-link-token", time.Now().Add(15 * time.Minute), nil
}

func (f *FakeUseCases) FindActiveTicketByTelegramChat(ctx context.Context, chatID string) (*domain.Ticket, error) {
	return nil, nil
}

func (f *FakeUseCases) CancelTicketByTelegram(ctx context.Context, chatID string) (*domain.Ticket, error) {
	return nil, application.ErrNotFound
}

func (f *FakeUseCases) ConfirmAppointment(ctx context.Context, ticketID, tokenOrCode string) (application.AppointmentView, error) {
	now := time.Now().UTC()
	return application.AppointmentView{
		Ticket: domain.Ticket{
			ID:           ticketID,
			PublicNumber: "A-000001",
			Status:       domain.TicketStatusScheduled,
		},
		ScheduledAt: now.Add(2 * time.Hour),
	}, nil
}

func (f *FakeUseCases) ResendAppointmentConfirmation(ctx context.Context, ticketID string) (string, string, time.Time, error) {
	return "fake-token", "123456", time.Now().Add(15 * time.Minute), nil
}

func (f *FakeUseCases) ExpirePendingAppointments(ctx context.Context, cutoff time.Time) (int64, error) {
	return 0, nil
}

var _ application.UseCases = (*FakeUseCases)(nil)


func (f *FakeUseCases) ArriveAppointment(ctx context.Context, id string) (application.AppointmentView, error) {
	return f.ArriveAppointmentFunc(ctx, id)
}
func (f *FakeUseCases) MarkNoShow(ctx context.Context, id string) (domain.Ticket, error) {
	return f.MarkNoShowFunc(ctx, id)
}
func (f *FakeUseCases) GetQueuePosition(ctx context.Context, id string) (domain.QueuePosition, error) {
	return f.GetQueuePositionFunc(ctx, id)
}

func (f *FakeUseCases) ListBranches(ctx context.Context) ([]domain.Branch, error) {
	return f.ListBranchesFunc(ctx)
}

func (f *FakeUseCases) SubmitFeedback(ctx context.Context, ticketID string, rating int, comment string) error {
	if f.SubmitFeedbackFunc != nil { return f.SubmitFeedbackFunc(ctx, ticketID, rating, comment) }
	return nil
}

func (f *FakeUseCases) ListBranchReviews(ctx context.Context, branchID string) ([]domain.RecentFeedback, error) {
	if f.ListBranchReviewsFunc != nil {
		return f.ListBranchReviewsFunc(ctx, branchID)
	}
	return nil, nil
}

func (f *FakeUseCases) SubmitBranchReview(ctx context.Context, branchID string, rating int, comment string) (domain.CreatedReview, error) {
	if f.SubmitBranchReviewFunc != nil {
		return f.SubmitBranchReviewFunc(ctx, branchID, rating, comment)
	}
	return domain.CreatedReview{
		ID:        "rev-test-1",
		BranchID:  branchID,
		Rating:    rating,
		Comment:   comment,
		CreatedAt: time.Now().UTC(),
	}, nil
}

func (f *FakeUseCases) GetAdminReviews(ctx context.Context, filter domain.AdminReviewsFilter) (domain.AdminReviewsResult, error) {
	if f.GetAdminReviewsFunc != nil {
		return f.GetAdminReviewsFunc(ctx, filter)
	}
	return domain.AdminReviewsResult{
		Items:      []domain.AdminReviewItem{},
		Total:      0,
		Page:       filter.Page,
		PageSize:   filter.PageSize,
		TotalPages: 0,
	}, nil
}

func (f *FakeUseCases) ListBranchServices(ctx context.Context, branchID string) ([]domain.Service, error) {
	return f.ListBranchServicesFunc(ctx, branchID)
}

func (f *FakeUseCases) ListBranchWindows(ctx context.Context, branchID string) ([]domain.Window, error) {
	return f.ListBranchWindowsFunc(ctx, branchID)
}

func (f *FakeUseCases) CreateQRTicket(ctx context.Context, cmd application.CreateQRTicketCommand) (application.CreateQRTicketResult, error) {
	return f.CreateQRTicketFunc(ctx, cmd)
}

func (f *FakeUseCases) GetTicket(ctx context.Context, ticketID string) (domain.Ticket, error) {
	return f.GetTicketFunc(ctx, ticketID)
}

func (f *FakeUseCases) GetCurrentTicket(ctx context.Context, windowID string) (*domain.Ticket, error) {
	return f.GetCurrentTicketFunc(ctx, windowID)
}

func (f *FakeUseCases) CallNext(ctx context.Context, windowID string) (domain.Ticket, error) {
	return f.CallNextFunc(ctx, windowID)
}

func (f *FakeUseCases) CallSpecificTicket(ctx context.Context, windowID string, ticketIDOrNumber string) (domain.Ticket, error) {
	if f.CallSpecificTicketFunc != nil {
		return f.CallSpecificTicketFunc(ctx, windowID, ticketIDOrNumber)
	}
	return f.CallNextFunc(ctx, windowID)
}

func (f *FakeUseCases) ReconcileStaleTickets(ctx context.Context, authoritativeTime time.Time) error {
	return nil
}

func (f *FakeUseCases) StartService(ctx context.Context, ticketID string) (domain.Ticket, error) {
	return f.StartServiceFunc(ctx, ticketID)
}

func (f *FakeUseCases) CompleteService(ctx context.Context, ticketID string) (domain.Ticket, error) {
	return f.CompleteServiceFunc(ctx, ticketID)
}

func (f *FakeUseCases) CreateLiveTicket(ctx context.Context, cmd application.CreateLiveTicketCommand) (application.CreateLiveTicketResult, error) {
	return f.CreateLiveTicketFunc(ctx, cmd)
}

func (f *FakeUseCases) CreateAppointment(ctx context.Context, cmd application.CreateAppointmentCommand) (application.CreateAppointmentResult, error) {
	return f.CreateAppointmentFunc(ctx, cmd)
}

func (f *FakeUseCases) CancelAppointment(ctx context.Context, ticketID string) (application.AppointmentView, error) {
	if f.CancelAppointmentFunc != nil {
		return f.CancelAppointmentFunc(ctx, ticketID)
	}
	return application.AppointmentView{}, nil
}

func (f *FakeUseCases) CancelTicket(ctx context.Context, ticketID string) (domain.Ticket, error) {
	if f.CancelTicketFunc != nil {
		return f.CancelTicketFunc(ctx, ticketID)
	}
	return domain.Ticket{}, nil
}

func (f *FakeUseCases) GetQueuePolicy(ctx context.Context, branchID string) (domain.QueuePolicy, error) {
	if f.GetQueuePolicyFunc != nil {
		return f.GetQueuePolicyFunc(ctx, branchID)
	}
	return domain.QueuePolicy{}, nil
}

func (f *FakeUseCases) UpdateQueuePolicy(ctx context.Context, cmd application.UpdateQueuePolicyCommand) (domain.QueuePolicy, error) {
	if f.UpdateQueuePolicyFunc != nil {
		return f.UpdateQueuePolicyFunc(ctx, cmd)
	}
	return domain.QueuePolicy{}, nil
}

func (f *FakeUseCases) ListTicketEvents(ctx context.Context, ticketID string) ([]domain.TicketEvent, error) {
	if f.ListTicketEventsFunc != nil {
		return f.ListTicketEventsFunc(ctx, ticketID)
	}
	return nil, nil
}

func (f *FakeUseCases) ChangeWindowStatus(ctx context.Context, windowID string, status domain.WindowStatus) (domain.Window, error) {
	return f.ChangeWindowStatusFunc(ctx, windowID, status)
}

func (f *FakeUseCases) UpdateWindowServices(ctx context.Context, cmd application.UpdateWindowServicesCommand) (domain.Window, error) {
	if f.UpdateWindowServicesFunc != nil {
		return f.UpdateWindowServicesFunc(ctx, cmd)
	}
	return domain.Window{}, nil
}

func (f *FakeUseCases) CreateWindow(ctx context.Context, branchID string) (domain.Window, error) {
	return domain.Window{ID: "new-window-id", BranchID: branchID, Number: 99, Status: domain.WindowStatusClosed}, nil
}

func (f *FakeUseCases) DeleteWindow(ctx context.Context, windowID string) error {
	return nil
}

func (f *FakeUseCases) ReturnTicket(ctx context.Context, ticketID string) (domain.Ticket, error) {
	return f.ReturnTicketFunc(ctx, ticketID)
}

func (f *FakeUseCases) RedirectTicket(ctx context.Context, cmd application.RedirectTicketCommand) (domain.Ticket, error) {
	return f.RedirectTicketFunc(ctx, cmd)
}

func (f *FakeUseCases) GetAdminOverview(ctx context.Context, branchID string) (domain.AdminBranchOverview, error) {
	return f.GetAdminOverviewFunc(ctx, branchID)
}

func (f *FakeUseCases) GetOperatorQueue(ctx context.Context, branchID string) (domain.OperatorQueue, error) {
	return domain.OperatorQueue{Items: []domain.AdminQueueTicket{}}, nil
}

func (f *FakeUseCases) SavePriorityRules(ctx context.Context, branchID string, rules []domain.PriorityRule) error {
	if f.SavePriorityRulesFunc != nil {
		return f.SavePriorityRulesFunc(ctx, branchID, rules)
	}
	return nil
}

func (f *FakeUseCases) GetBranchWorkload(ctx context.Context, branchID string) (domain.BranchWorkload, error) {
	if f.GetBranchWorkloadFunc != nil {
		return f.GetBranchWorkloadFunc(ctx, branchID)
	}
	return domain.BranchWorkload{}, nil
}

func (f *FakeUseCases) CloseShift(ctx context.Context, branchID string) (domain.ShiftClosureResult, error) {
	if f.CloseShiftFunc != nil {
		return f.CloseShiftFunc(ctx, branchID)
	}
	return domain.ShiftClosureResult{}, nil
}

func (f *FakeUseCases) UpdateBranchSchedule(ctx context.Context, branchID string, workHours string) (domain.Branch, error) {
	if f.UpdateBranchScheduleFunc != nil {
		return f.UpdateBranchScheduleFunc(ctx, branchID, workHours)
	}
	return domain.Branch{}, nil
}

func (f *FakeUseCases) Register(ctx context.Context, email, password string) (domain.User, error) {
	if f.RegisterFunc != nil {
		return f.RegisterFunc(ctx, email, password)
	}
	return domain.User{}, nil
}

func (f *FakeUseCases) ConfirmEmail(ctx context.Context, token string) error {
	if f.ConfirmEmailFunc != nil {
		return f.ConfirmEmailFunc(ctx, token)
	}
	return nil
}

func (f *FakeUseCases) ConfirmEmailByCode(ctx context.Context, email, code string) (domain.Session, domain.User, error) {
	if f.ConfirmEmailByCodeFunc != nil {
		return f.ConfirmEmailByCodeFunc(ctx, email, code)
	}
	return domain.Session{}, domain.User{}, nil
}

func (f *FakeUseCases) ConfirmEmailByToken(ctx context.Context, token string) (domain.Session, domain.User, error) {
	if f.ConfirmEmailByTokenFunc != nil {
		return f.ConfirmEmailByTokenFunc(ctx, token)
	}
	return domain.Session{}, domain.User{}, nil
}

func (f *FakeUseCases) ResendEmailConfirmation(ctx context.Context, email string) (string, string, error) {
	if f.ResendEmailConfirmationFunc != nil {
		return f.ResendEmailConfirmationFunc(ctx, email)
	}
	return "123456", "token", nil
}

func (f *FakeUseCases) Login(ctx context.Context, email, password string) (domain.Session, error) {
	if f.LoginFunc != nil {
		return f.LoginFunc(ctx, email, password)
	}
	return domain.Session{}, nil
}

func (f *FakeUseCases) LoginOAuth(ctx context.Context, email string) (domain.Session, error) {
	if f.LoginOAuthFunc != nil {
		return f.LoginOAuthFunc(ctx, email)
	}
	return domain.Session{Token: "fake-oauth-token", UserID: "fake-user-id", ExpiresAt: time.Now().Add(time.Hour)}, nil
}

func (f *FakeUseCases) Logout(ctx context.Context, token string) error {
	if f.LogoutFunc != nil {
		return f.LogoutFunc(ctx, token)
	}
	return nil
}

func (f *FakeUseCases) GetSessionUser(ctx context.Context, token string) (domain.User, error) {
	if f.GetSessionUserFunc != nil {
		return f.GetSessionUserFunc(ctx, token)
	}
	if token == testSessionToken {
		return testUser(), nil
	}
	return domain.User{}, application.ErrNotFound
}

func (f *FakeUseCases) ListUsers(ctx context.Context, limit, offset int, search, role string) (domain.UserPage, error) {
	if f.ListUsersFunc != nil {
		return f.ListUsersFunc(ctx, limit, offset, search, role)
	}
	return domain.UserPage{}, nil
}
func (f *FakeUseCases) ListAnomalies(ctx context.Context, branchID string, limit, offset int) (domain.AnomalyPage, error) {
	if f.ListAnomaliesFunc != nil {
		return f.ListAnomaliesFunc(ctx, branchID, limit, offset)
	}
	return domain.AnomalyPage{}, nil
}

func (f *FakeUseCases) ChangeUserRole(ctx context.Context, userID string, role domain.UserRole) (domain.User, error) {
	if f.ChangeUserRoleFunc != nil {
		return f.ChangeUserRoleFunc(ctx, userID, role)
	}
	return domain.User{}, nil
}

func (f *FakeUseCases) SetUserPhoneCode(ctx context.Context, userID, phone, code string, expiresAt time.Time) error {
	return nil
}

func (f *FakeUseCases) VerifyUserPhoneCode(ctx context.Context, userID, code string) (domain.User, error) {
	return domain.User{ID: userID, PhoneVerified: true}, nil
}

func (f *FakeUseCases) FindPendingSMSAppointments(ctx context.Context, windowMinutes int) ([]domain.AppointmentSMSNotification, error) {
	return nil, nil
}

func (f *FakeUseCases) MarkSMSAppointmentReminderSent(ctx context.Context, ticketID string) error {
	return nil
}

// testSessionToken is the opaque cookie value the handler tests present to
// loadSession. The fake resolves it through GetSessionUser.
const testSessionToken = "test-session"

// testUser carries the widest role so legacy handler tests exercise routing and
// DTO mapping instead of authentication. Auth-specific tests override
// GetSessionUserFunc to simulate a missing or expired session.
func testUser() domain.User {
	return domain.User{ID: "u1", Email: "test@pochta.local", Role: domain.RoleOPCChief, IsTerminal: true, Confirmed: true}
}

func setupTest(usecases *FakeUseCases) http.Handler {
	db := &fakeDB{}
	logger := slog.New(slog.NewJSONHandler(bytes.NewBuffer(nil), nil))
	router := NewRouter(db, usecases, logger, "http://localhost:3000")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := r.Cookie(sessionCookie); err != nil {
			r.AddCookie(&http.Cookie{Name: sessionCookie, Value: testSessionToken})
		}
		router.ServeHTTP(w, r)
	})
}

func TestListBranches(t *testing.T) {
	uc := &FakeUseCases{
		ListBranchesFunc: func(ctx context.Context) ([]domain.Branch, error) {
			return []domain.Branch{{
				ID:             "b1",
				Name:           "Branch 1",
				Address:        "ул. Ленина, 1",
				WorkHours:      "08:00-20:00",
				TimezoneOffset: 3,
			}}, nil
		},
	}
	r := setupTest(uc)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/branches", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var res ListBranchesResponse
	if err := json.NewDecoder(rec.Body).Decode(&res); err != nil {
		t.Fatal(err)
	}
	if len(res.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(res.Items))
	}
	got := res.Items[0]
	want := BranchDTO{ID: "b1", Name: "Branch 1", Address: "ул. Ленина, 1", WorkHours: "08:00-20:00", TimezoneOffset: 3}
	if got != want {
		t.Errorf("expected %+v, got %+v", want, got)
	}
}

func TestCreateQRTicket(t *testing.T) {
	called := 0
	uc := &FakeUseCases{
		CreateQRTicketFunc: func(ctx context.Context, cmd application.CreateQRTicketCommand) (application.CreateQRTicketResult, error) {
			called++
			if cmd.IdempotencyKey == "conflict" {
				return application.CreateQRTicketResult{}, application.ErrIdempotencyConflict
			}
			return application.CreateQRTicketResult{
				Ticket:   domain.Ticket{ID: "t1", Status: domain.TicketStatusWaiting},
				Replayed: cmd.IdempotencyKey == "replay",
			}, nil
		},
	}
	r := setupTest(uc)

	t.Run("success 201", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/branches/b1/tickets/qr", bytes.NewBufferString(`{"serviceId":"s1"}`))
		req.Header.Set("Idempotency-Key", "new-key")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Errorf("expected 201, got %d", rec.Code)
		}
	})

	t.Run("replay 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/branches/b1/tickets/qr", bytes.NewBufferString(`{"serviceId":"s1"}`))
		req.Header.Set("Idempotency-Key", "replay")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("expected 200, got %d", rec.Code)
		}
	})

	t.Run("missing idempotency key", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/branches/b1/tickets/qr", bytes.NewBufferString(`{"serviceId":"s1"}`))
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("expected 400, got %d", rec.Code)
		}
		var errResp ErrorResponse
		json.Unmarshal(rec.Body.Bytes(), &errResp)
		if errResp.Error.Code != "VALIDATION_ERROR" {
			t.Errorf("expected VALIDATION_ERROR, got %s", errResp.Error.Code)
		}
	})

	t.Run("conflict", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/branches/b1/tickets/qr", bytes.NewBufferString(`{"serviceId":"s1"}`))
		req.Header.Set("Idempotency-Key", "conflict")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusConflict {
			t.Errorf("expected 409, got %d", rec.Code)
		}
		var errResp ErrorResponse
		json.Unmarshal(rec.Body.Bytes(), &errResp)
		if errResp.Error.Code != "IDEMPOTENCY_CONFLICT" {
			t.Errorf("expected IDEMPOTENCY_CONFLICT, got %s", errResp.Error.Code)
		}
	})
}

func TestErrors(t *testing.T) {
	uc := &FakeUseCases{
		GetCurrentTicketFunc: func(ctx context.Context, windowID string) (*domain.Ticket, error) {
			if windowID == "notfound" {
				return nil, application.ErrNotFound
			}
			return nil, nil
		},
		CallNextFunc: func(ctx context.Context, windowID string) (domain.Ticket, error) {
			if windowID == "busy" {
				return domain.Ticket{}, application.ErrWindowBusy
			}
			return domain.Ticket{}, application.ErrNoEligibleTickets
		},
	}
	r := setupTest(uc)

	t.Run("not found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operator/windows/notfound/current-ticket", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("expected 404, got %d", rec.Code)
		}
	})

	t.Run("no content", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/operator/windows/empty/current-ticket", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Errorf("expected 204, got %d", rec.Code)
		}
	})

	t.Run("window busy", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/operator/windows/busy/call-next", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusConflict {
			t.Errorf("expected 409, got %d", rec.Code)
		}
		var resp ErrorResponse
		json.Unmarshal(rec.Body.Bytes(), &resp)
		if resp.Error.Code != "WINDOW_BUSY" {
			t.Errorf("expected WINDOW_BUSY, got %s", resp.Error.Code)
		}
	})

	t.Run("no eligible tickets", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/operator/windows/empty/call-next", nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		if rec.Code != http.StatusConflict {
			t.Errorf("expected 409, got %d", rec.Code)
		}
		var resp ErrorResponse
		json.Unmarshal(rec.Body.Bytes(), &resp)
		if resp.Error.Code != "NO_ELIGIBLE_TICKETS" {
			t.Errorf("expected NO_ELIGIBLE_TICKETS, got %s", resp.Error.Code)
		}
		if resp.Error.RequestID == "" {
			t.Errorf("expected request ID to be present")
		}
	})
}

func TestMetricsEndpoint(t *testing.T) {
	uc := &FakeUseCases{}
	r := setupTest(uc)

	healthReq := httptest.NewRequest(http.MethodGet, "/health", nil)
	healthRec := httptest.NewRecorder()
	r.ServeHTTP(healthRec, healthReq)

	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	body := rec.Body.String()
	if !strings.Contains(body, "http_requests_total") {
		t.Errorf("expected http_requests_total metric in output")
	}
	if !strings.Contains(body, "go_goroutines") {
		t.Errorf("expected go_goroutines metric in output")
	}
}

// Package application defines the transport-independent Sprint #1 boundary.
package application

import (
	"context"
	"errors"
	"fmt"
	"postcode/backend/internal/domain"
	"time"
)

var (
	ErrNotFound               = errors.New("not found")
	ErrInvalidState           = errors.New("invalid state")
	ErrWindowClosed           = fmt.Errorf("window closed: %w", ErrInvalidState)
	ErrWindowBusy             = errors.New("window busy")
	ErrNoEligibleTickets      = errors.New("no eligible tickets")
	ErrNotEligibleYet         = errors.New("not eligible yet")
	ErrNoOpenCompatibleWindow = errors.New("no open compatible window")
	ErrIdempotencyConflict    = errors.New("idempotency conflict")
	ErrForbidden              = errors.New("forbidden")
	ErrUnauthorized           = errors.New("unauthorized")
)

type CreateQRTicketCommand struct {
	BranchID       string
	ServiceID      string
	IdempotencyKey string
}
type CreateQRTicketResult struct {
	Ticket   domain.Ticket
	Replayed bool
}

type CreateLiveTicketCommand struct {
	BranchID       string
	ServiceID      string
	IdempotencyKey string
	ClientID       *string
}

type CreateLiveTicketResult struct {
	Ticket   domain.Ticket
	Replayed bool
}

type CreateAppointmentCommand struct {
	BranchID          string
	ServiceID         string
	ScheduledAt       time.Time
	IdempotencyKey    string
	ClientID          *string
	NotificationEmail string
	NotificationPhone string
}

// UpdateWindowServicesCommand replaces the set of services a postal window is
// allowed to serve (window_services). At least one service is required, because a
// window without capabilities can never be assigned a ticket by the queue engine.
type UpdateWindowServicesCommand struct {
	WindowID   string
	ServiceIDs []string
}

type RedirectTicketCommand struct {
	TicketID     string
	NewServiceID string
	NewWindowID  string // optional
}
type UseCases interface {
	GetTicketETA(ctx context.Context, ticketID string) (domain.TicketETA, error)
	ArriveAppointment(ctx context.Context, ticketID string) (AppointmentView, error)
	MarkNoShow(ctx context.Context, ticketID string) (domain.Ticket, error)
	GetQueuePosition(ctx context.Context, ticketID string) (domain.QueuePosition, error)
	ListBranches(ctx context.Context) ([]domain.Branch, error)
	SubmitFeedback(ctx context.Context, ticketID string, rating int, comment string) error
	ListBranchServices(ctx context.Context, branchID string) ([]domain.Service, error)
	ListBranchWindows(ctx context.Context, branchID string) ([]domain.Window, error)
	CreateQRTicket(ctx context.Context, cmd CreateQRTicketCommand) (CreateQRTicketResult, error)
	CreateLiveTicket(ctx context.Context, cmd CreateLiveTicketCommand) (CreateLiveTicketResult, error)
	CreateAppointment(ctx context.Context, cmd CreateAppointmentCommand) (CreateAppointmentResult, error)
	CancelAppointment(ctx context.Context, ticketID string) (AppointmentView, error)
	CancelTicket(ctx context.Context, ticketID string) (domain.Ticket, error)
	GetQueuePolicy(ctx context.Context, branchID string) (domain.QueuePolicy, error)
	UpdateQueuePolicy(ctx context.Context, cmd UpdateQueuePolicyCommand) (domain.QueuePolicy, error)
	ListTicketEvents(ctx context.Context, ticketID string) ([]domain.TicketEvent, error)

	GetTicket(ctx context.Context, ticketID string) (domain.Ticket, error)
	GetCurrentTicket(ctx context.Context, windowID string) (*domain.Ticket, error)

	ChangeWindowStatus(ctx context.Context, windowID string, status domain.WindowStatus) (domain.Window, error)
	UpdateWindowServices(ctx context.Context, cmd UpdateWindowServicesCommand) (domain.Window, error)
	CreateWindow(ctx context.Context, branchID string) (domain.Window, error)
	DeleteWindow(ctx context.Context, windowID string) error
	CallNext(ctx context.Context, windowID string) (domain.Ticket, error)
	CallSpecificTicket(ctx context.Context, windowID string, ticketIDOrNumber string) (domain.Ticket, error)
	ReconcileStaleTickets(ctx context.Context, authoritativeTime time.Time) error

	StartService(ctx context.Context, ticketID string) (domain.Ticket, error)
	CompleteService(ctx context.Context, ticketID string) (domain.Ticket, error)
	ReturnTicket(ctx context.Context, ticketID string) (domain.Ticket, error)
	RedirectTicket(ctx context.Context, cmd RedirectTicketCommand) (domain.Ticket, error)
	GetAdminOverview(ctx context.Context, branchID string) (domain.AdminBranchOverview, error)
	GetOperatorQueue(ctx context.Context, branchID string) (domain.OperatorQueue, error)
	SavePriorityRules(ctx context.Context, branchID string, rules []domain.PriorityRule) error

	GetBranchWorkload(ctx context.Context, branchID string) (domain.BranchWorkload, error)
	CloseShift(ctx context.Context, branchID string) (domain.ShiftClosureResult, error)
	UpdateBranchSchedule(ctx context.Context, branchID string, workHours string) (domain.Branch, error)

	// Auth & Roles
	Register(ctx context.Context, email, password string) (domain.User, error)
	ConfirmEmail(ctx context.Context, token string) error
	ConfirmEmailByCode(ctx context.Context, email, code string) (domain.Session, domain.User, error)
	ConfirmEmailByToken(ctx context.Context, token string) (domain.Session, domain.User, error)
	ResendEmailConfirmation(ctx context.Context, email string) (code, token string, err error)
	Login(ctx context.Context, email, password string) (domain.Session, error)
	LoginOAuth(ctx context.Context, email string) (domain.Session, error)
	Logout(ctx context.Context, token string) error
	GetSessionUser(ctx context.Context, token string) (domain.User, error)
	ListUsers(ctx context.Context, limit, offset int, search, role string) (domain.UserPage, error)
	ListAnomalies(ctx context.Context, branchID string, limit, offset int) (domain.AnomalyPage, error)
	ChangeUserRole(ctx context.Context, userID string, role domain.UserRole) (domain.User, error)
	SetUserPhoneCode(ctx context.Context, userID, phone, code string, expiresAt time.Time) error
	VerifyUserPhoneCode(ctx context.Context, userID, code string) (domain.User, error)
	FindPendingSMSAppointments(ctx context.Context, windowMinutes int) ([]domain.AppointmentSMSNotification, error)
	MarkSMSAppointmentReminderSent(ctx context.Context, ticketID string) error

	// Notifications
	ListNotificationOutbox(ctx context.Context, limit, offset int, status string) ([]domain.NotificationOutboxItem, int, error)

	// Operator Incidents
	ReportIncident(ctx context.Context, cmd ReportIncidentCommand) (domain.OperatorIncident, error)

	// External & Voice Integrations
	GetOrCreateExternalUser(ctx context.Context, provider, externalUserID string) (domain.User, error)
	FindActiveTicketByClient(ctx context.Context, clientID string) (*domain.Ticket, error)
}

type ReportIncidentCommand struct {
	BranchID    string
	WindowID    *string
	OperatorID  *string
	Category    string
	Description string
}

var ErrPolicyVersionConflict = errors.New("queue policy version conflict")

type AppointmentView struct {
	Ticket      domain.Ticket
	ScheduledAt time.Time
}
type CreateAppointmentResult struct {
	Appointment AppointmentView
	Replayed    bool
}
type UpdateQueuePolicyCommand struct {
	BranchID                        string
	AppointmentDuePriority          int
	QRPriority                      int
	LivePriority                    int
	AntiStarvationThresholdMinutes  int
	AntiStarvationPointsPerMinute   int
	AppointmentGraceMinutes         int
	AppointmentLatePenaltyPerMinute int
	AppointmentLatePenaltyMaxPoints int
	ExpectedVersion                 int64
}

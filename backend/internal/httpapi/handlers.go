package httpapi

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
	"postcode/backend/internal/integrations/alice"
	"postcode/backend/internal/mailer"
	"postcode/backend/internal/sms"
	"postcode/backend/internal/voice"
)

type API struct {
	usecases     application.UseCases
	smsClient    *sms.Client
	mailer       *mailer.Mailer
	voiceService *voice.VoiceService
	aliceHandler *alice.Handler
}

func NewAPI(usecases application.UseCases) *API {
	vService := voice.NewVoiceService(usecases, nil, slog.Default())
	return &API{
		usecases:     usecases,
		smsClient:    sms.NewClient(slog.Default()),
		mailer:       mailer.New(mailer.ConfigFromEnv()),
		voiceService: vService,
		aliceHandler: alice.NewHandler(vService, slog.Default()),
	}
}

func (a *API) RegisterRoutes(r chi.Router) {
	r.Post("/integrations/telegram/webhook", a.TelegramWebhook)
	r.Post("/integrations/alice/webhook", a.AliceWebhook)
	r.Post("/api/integrations/alice/webhook", a.AliceWebhook)
	r.Post("/api/v1/integrations/alice/webhook", a.AliceWebhook)
	r.Route("/api/v1", func(r chi.Router) {
		r.Use(a.loadSession)

		// ── Auth (публичные) ──────────────────────────────────────────────
		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", a.Register)
			r.Get("/confirm", a.ConfirmEmail)
			r.Post("/confirm-code", a.ConfirmEmailCode)
			r.Post("/resend-code", a.ResendEmailCode)
			r.Post("/login", a.Login)
			r.Post("/logout", a.Logout)
			r.Get("/me", a.GetMe) // возвращает 401 если нет сессии
			r.Get("/oauth/{provider}/login", a.OAuthLogin)
			r.Get("/oauth/{provider}/callback", a.OAuthCallback)
			r.Post("/profile/phone/send-code", a.SendPhoneCode)
			r.Post("/profile/phone/verify-code", a.VerifyPhoneCode)
		})

		// ── Клиент: публичные ─────────────────────────────────────────────
		r.Get("/branches", a.ListBranches)
		r.Get("/branches/{branchId}/services", a.ListBranchServices)
		r.Post("/branches/{branchId}/tickets/qr", a.CreateQRTicket)
		r.Post("/branches/{branchId}/tickets/live", a.CreateLiveTicket)
		r.Post("/branches/{branchId}/tickets/appointment", a.CreateAppointment)
		r.Post("/appointments", a.CreateAppointment)
		r.Post("/appointments/{ticketId}/cancel", a.CancelAppointment)
		r.Post("/appointments/{ticketId}/arrive", a.ArriveAppointment)
		r.Get("/tickets/{ticketId}", a.GetTicket)
		r.Post("/tickets/{ticketId}/feedback", a.SubmitFeedback)
		r.Post("/tickets/{ticketId}/cancel", a.CancelTicket)
		r.Get("/tickets/{ticketId}/position", a.GetQueuePosition)
		r.Get("/tickets/{ticketId}/eta", a.GetTicketETA)
		r.Get("/notification-capabilities", a.NotificationCapabilities)
		r.Get("/tickets/{ticketId}/notifications", a.Notifications)
		r.Post("/tickets/{ticketId}/notifications/telegram/link", a.TelegramLink)
		r.Put("/tickets/{ticketId}/notifications/{channel}", a.PutNotificationSubscription)
		r.Delete("/tickets/{ticketId}/notifications/{channel}/{subscriptionId}", a.DeleteNotificationSubscription)
		r.Get("/branches/{branchId}/tv", a.GetTVQueue)
		r.Get("/branches/{branchId}/workload", a.GetBranchWorkload)
		r.Get("/branches/{branchId}/reviews", a.GetBranchReviews)
		r.Get("/client/tickets/active", a.ListMyActiveTickets)
		r.With(requireRole(domain.RoleOPCChief)).Post("/branches/{branchId}/windows", a.CreateWindow)
		r.With(requireRole(domain.RoleOPCChief)).Delete("/windows/{windowId}", a.DeleteWindow)

		// ── RAG AI Agent Proxy ──────────────────────────────────────────
		agentURLStr := os.Getenv("RAG_AGENT_URL")
		if agentURLStr == "" {
			agentURLStr = "http://rag-agent:8095"
		}
		if agentURL, err := url.Parse(agentURLStr); err == nil {
			agentProxy := httputil.NewSingleHostReverseProxy(agentURL)
			r.HandleFunc("/agent/*", func(w http.ResponseWriter, req *http.Request) {
				req.URL.Path = "/api" + strings.TrimPrefix(req.URL.Path, "/api/v1")
				agentProxy.ServeHTTP(w, req)
			})
		}

		// ── Оператор (employee + opc_chief) ──────────────────────────────
		r.Route("/operator", func(r chi.Router) {
			r.Use(requireRole(domain.RoleEmployee, domain.RoleOPCChief))
			r.Post("/branches/{branchId}/tickets/live", a.CreateLiveTicket)
			r.Get("/branches/{branchId}/windows", a.ListBranchWindows)
			r.Get("/windows/{windowId}/current-ticket", a.GetCurrentTicket)
			r.Post("/windows/{windowId}/call-next", a.CallNext)
			r.Post("/tickets/{ticketId}/start", a.StartService)
			r.Post("/tickets/{ticketId}/complete", a.CompleteService)
			r.Post("/tickets/{ticketId}/no-show", a.MarkNoShow)
			r.Post("/tickets/{ticketId}/return", a.ReturnTicket)
			r.Post("/tickets/{ticketId}/redirect", a.RedirectTicket)
			r.Post("/branches/{branchId}/incidents", a.ReportIncident)
		})

		// ── Администратор (opc_chief; отдельные точки чтения/статуса окна доступны employee) ──
		r.Route("/admin", func(r chi.Router) {
			r.Use(requireRole(domain.RoleEmployee, domain.RoleOPCChief))

			// Операции, доступные оператору окна (просмотр очереди отделения, чтение политики, статус окна, услуги окна)
			r.Get("/branches/{branchId}/queue", a.GetOperatorQueue)
			r.Get("/branches/{branchId}/queue-policy", a.GetQueuePolicy)
			r.Put("/windows/{windowId}/status", a.ChangeWindowStatus)
			r.Put("/windows/{windowId}/services", a.UpdateWindowServices)

			// Операции управления отделением — строго начальник ОПС (opc_chief)
			r.Group(func(r chi.Router) {
				r.Use(requireRole(domain.RoleOPCChief))
				r.Get("/branches/{branchId}/overview", a.GetAdminOverview)
				r.Get("/branches/{branchId}/anomalies", a.ListAnomalies)
				r.Put("/branches/{branchId}/priorities", a.SavePriorityRules)
				r.Put("/branches/{branchId}/queue-policy", a.UpdateQueuePolicy)
				r.Post("/branches/{branchId}/close-shift", a.CloseShift)
				r.Put("/branches/{branchId}/schedule", a.UpdateBranchSchedule)
				r.Get("/tickets/{ticketId}/events", a.ListTicketEvents)
				r.Get("/notifications/outbox", a.ListNotificationOutbox)
				r.Post("/branches/{branchId}/windows", a.CreateWindow)
				r.Delete("/windows/{windowId}", a.DeleteWindow)
				r.Get("/users", a.ListUsers)
				r.Put("/users/{userID}/role", a.ChangeUserRole)
			})
		})

		// ── Терминал (is_terminal=true) ───────────────────────────────────
		r.Route("/terminal", func(r chi.Router) {
			r.Use(requireTerminal)
			r.Post("/branches/{branchId}/tickets/live", a.CreateLiveTicket)
			r.Get("/branches/{branchId}/services", a.ListBranchServices)
		})
	})
}

// -----------------------------------------------------------------------------
// Responses DTOs
// -----------------------------------------------------------------------------

type ListBranchesResponse struct {
	Items []BranchDTO `json:"items"`
}

type BranchDTO struct {
	Latitude       *float64 `json:"latitude,omitempty"`
	Longitude      *float64 `json:"longitude,omitempty"`
	IsDemo         bool     `json:"isDemo"`
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Address        string   `json:"address"`
	WorkHours      string   `json:"workHours"`
	TimezoneOffset int      `json:"timezoneOffset"`
	RatingAverage  *float64 `json:"ratingAverage"`
	RatingCount    int      `json:"ratingCount"`
}

type ListServicesResponse struct {
	Items []ServiceDTO `json:"items"`
}

type ServiceDTO struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}

type WindowRefDTO struct {
	ID     string `json:"id"`
	Number int    `json:"number"`
}

type TicketDTO struct {
	ID               string        `json:"id"`
	PublicNumber     string        `json:"publicNumber"`
	BranchID         string        `json:"branchId"`
	ServiceID        string        `json:"serviceId"`
	ServiceName      string        `json:"serviceName,omitempty"`
	Source           string        `json:"source"`
	Status           string        `json:"status"`
	Window           *WindowRefDTO `json:"window"`
	CreatedAt        time.Time     `json:"createdAt"`
	QueueEnteredAt   time.Time     `json:"queueEnteredAt"`
	CalledAt         *time.Time    `json:"calledAt"`
	ServiceStartedAt *time.Time    `json:"serviceStartedAt"`
	CompletedAt      *time.Time    `json:"completedAt"`
	ManagementToken  *string       `json:"managementToken,omitempty"`
}

type WindowDTO struct {
	ID       string       `json:"id"`
	Number   int          `json:"number"`
	Status   string       `json:"status"`
	Services []ServiceDTO `json:"services"`
}

type ListWindowsResponse struct {
	Items []WindowDTO `json:"items"`
}

type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}

type ErrorDetail struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId"`
}

// -----------------------------------------------------------------------------
// Mapping Helpers
// -----------------------------------------------------------------------------

// mapWindowDTO keeps every window response (operator list, status change, capability
// change) identical, so the frontend can consume any of them with one mapper.
func mapWindowDTO(wnd domain.Window) WindowDTO {
	services := make([]ServiceDTO, len(wnd.Services))
	for i, s := range wnd.Services {
		services[i] = ServiceDTO{ID: s.ID, Code: s.Code, Name: s.Name}
	}
	return WindowDTO{
		ID:       wnd.ID,
		Number:   wnd.Number,
		Status:   string(wnd.Status),
		Services: services,
	}
}

func mapTicket(t domain.Ticket) TicketDTO {
	var window *WindowRefDTO
	if t.Window != nil {
		window = &WindowRefDTO{
			ID:     t.Window.ID,
			Number: t.Window.Number,
		}
	}
	var mgmtToken *string
	if t.ManagementToken != nil && *t.ManagementToken != "" {
		mgmtToken = t.ManagementToken
	}
	return TicketDTO{
		ID:               t.ID,
		PublicNumber:     t.PublicNumber,
		BranchID:         t.BranchID,
		ServiceID:        t.ServiceID,
		ServiceName:      t.ServiceName,
		Source:           string(t.Source),
		Status:           string(t.Status),
		Window:           window,
		CreatedAt:        t.CreatedAt,
		QueueEnteredAt:   t.QueueEnteredAt,
		CalledAt:         t.CalledAt,
		ServiceStartedAt: t.ServiceStartedAt,
		CompletedAt:      t.CompletedAt,
		ManagementToken:  mgmtToken,
	}
}

func (a *API) respondError(w http.ResponseWriter, r *http.Request, err error) {
	var status int
	var code string

	switch {
	case errors.Is(err, application.ErrNotFound):
		status = http.StatusNotFound
		code = "NOT_FOUND"
	case errors.Is(err, application.ErrForbidden):
		status = http.StatusForbidden
		code = "FORBIDDEN"
	case errors.Is(err, application.ErrUnauthorized):
		status = http.StatusUnauthorized
		code = "UNAUTHORIZED"
	case errors.Is(err, application.ErrIdempotencyConflict):
		status = http.StatusConflict
		code = "IDEMPOTENCY_CONFLICT"
	case errors.Is(err, application.ErrWindowBusy):
		status = http.StatusConflict
		code = "WINDOW_BUSY"
	case errors.Is(err, application.ErrNoEligibleTickets):
		status = http.StatusConflict
		code = "NO_ELIGIBLE_TICKETS"
	case errors.Is(err, application.ErrNotEligibleYet):
		status = http.StatusConflict
		code = "NOT_ELIGIBLE_YET"
	case errors.Is(err, application.ErrNoOpenCompatibleWindow):
		status = http.StatusConflict
		code = "NO_OPEN_COMPATIBLE_WINDOW"
	case errors.Is(err, application.ErrInvalidState):
		status = http.StatusConflict
		code = "INVALID_TICKET_STATE"
	case errors.Is(err, application.ErrWindowClosed):
		status = http.StatusConflict
		code = "WINDOW_CLOSED"
	case errors.Is(err, application.ErrPolicyVersionConflict):
		status = http.StatusConflict
		code = "POLICY_VERSION_CONFLICT"
	default:
		status = http.StatusInternalServerError
		code = "INTERNAL_ERROR"
	}

	message := code
	// Wrapped application errors may contain internal/driver context.
	if status == http.StatusInternalServerError {
		slog.ErrorContext(r.Context(), "internal server error", "error", err, "path", r.URL.Path)
		message = "Internal server error"
	}
	writeJSONError(w, r, status, code, message)
}

func writeJSONError(w http.ResponseWriter, r *http.Request, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(ErrorResponse{
		Error: ErrorDetail{
			Code:      code,
			Message:   msg,
			RequestID: requestID(r),
		},
	})
}

func writeJSONResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (a *API) AliceWebhook(w http.ResponseWriter, r *http.Request) {
	a.aliceHandler.ServeHTTP(w, r)
}


// Handlers are located in client_handlers.go, operator_handlers.go, and admin_handlers.go

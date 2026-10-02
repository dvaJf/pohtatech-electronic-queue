package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
	"postcode/backend/internal/observability"
	"postcode/backend/internal/persistence"
)

func (a *API) ListBranches(w http.ResponseWriter, r *http.Request) {
	branches, err := a.usecases.ListBranches(r.Context())
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	res := ListBranchesResponse{Items: make([]BranchDTO, len(branches))}
	for i, b := range branches {
		res.Items[i] = BranchDTO{ID: b.ID, Name: b.Name, Address: b.Address, WorkHours: b.WorkHours, TimezoneOffset: b.TimezoneOffset, Latitude: b.Latitude, Longitude: b.Longitude, IsDemo: b.IsDemo, RatingAverage: b.RatingAverage, RatingCount: b.RatingCount}
	}
	writeJSONResponse(w, http.StatusOK, res)
}

func (a *API) ListBranchServices(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	services, err := a.usecases.ListBranchServices(r.Context(), branchID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	res := ListServicesResponse{Items: make([]ServiceDTO, len(services))}
	for i, s := range services {
		res.Items[i] = ServiceDTO{ID: s.ID, Code: s.Code, Name: s.Name}
	}
	writeJSONResponse(w, http.StatusOK, res)
}

type CreateQRTicketRequest struct {
	ServiceID string `json:"serviceId"`
}

func (a *API) CreateQRTicket(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	idempotencyKey := r.Header.Get("Idempotency-Key")
	if idempotencyKey == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Missing Idempotency-Key header")
		return
	}

	var req CreateQRTicketRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ServiceID == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}

	res, err := a.usecases.CreateQRTicket(r.Context(), application.CreateQRTicketCommand{
		BranchID:       branchID,
		ServiceID:      req.ServiceID,
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	status := http.StatusCreated
	if res.Replayed {
		status = http.StatusOK
	}
	writeJSONResponse(w, status, mapTicket(res.Ticket))
}

func (a *API) GetTicket(w http.ResponseWriter, r *http.Request) {
	ticketID := chi.URLParam(r, "ticketId")
	ticket, err := a.usecases.GetTicket(r.Context(), ticketID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, mapTicket(ticket))
}

type SubmitFeedbackRequest struct {
	Rating  int    `json:"rating"`
	Comment string `json:"comment"`
}

// SubmitFeedback accepts no branch id: a protected completed ticket determines it.
func (a *API) SubmitFeedback(w http.ResponseWriter, r *http.Request) {
	var req SubmitFeedbackRequest
	if err := decodeRequest(r, &req); err != nil || req.Rating < 1 || req.Rating > 5 || len([]rune(req.Comment)) > 500 {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "rating must be from 1 to 5; comment is at most 500 characters")
		return
	}
	ctx := persistence.WithManagementToken(r.Context(), r.Header.Get("X-Ticket-Manage-Token"))
	if err := a.usecases.SubmitFeedback(ctx, chi.URLParam(r, "ticketId"), req.Rating, strings.TrimSpace(req.Comment)); err != nil {
		a.respondError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type CreateLiveTicketRequest struct {
	ServiceID string `json:"serviceId"`
}

func (a *API) CreateLiveTicket(w http.ResponseWriter, r *http.Request) {
	ctx, span := observability.Tracer("queue-backend").Start(r.Context(), "handler.CreateLiveTicket")
	defer span.End()

	branchID := chi.URLParam(r, "branchId")
	if !validUUID(branchID) {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid branchId")
		return
	}
	idempotencyKey := r.Header.Get("Idempotency-Key")
	if strings.TrimSpace(idempotencyKey) == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Missing Idempotency-Key header")
		return
	}

	var req CreateLiveTicketRequest
	if err := decodeRequest(r, &req); err != nil || !validUUID(req.ServiceID) {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}

	ticket, err := a.usecases.CreateLiveTicket(ctx, application.CreateLiveTicketCommand{
		BranchID:       branchID,
		ServiceID:      req.ServiceID,
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	status := http.StatusCreated
	if ticket.Replayed {
		status = http.StatusOK
	}
	writeJSONResponse(w, status, mapTicket(ticket.Ticket))
}

type CreateAppointmentRequest struct {
	BranchID    string `json:"branchId"`
	ServiceID   string `json:"serviceId"`
	ScheduledAt string `json:"scheduledAt"`
	Email       string `json:"email,omitempty"`
	Phone       string `json:"phone,omitempty"`
}

type AppointmentResponse struct {
	Ticket          TicketDTO `json:"ticket"`
	ScheduledAt     time.Time `json:"scheduledAt"`
	ManagementToken *string   `json:"managementToken,omitempty"`
}

func (a *API) CreateAppointment(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	idempotencyKey := r.Header.Get("Idempotency-Key")
	if idempotencyKey == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Missing Idempotency-Key header")
		return
	}

	var req CreateAppointmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ServiceID == "" || req.ScheduledAt == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}

	if branchID == "" {
		branchID = req.BranchID
	}
	if branchID == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Missing branchId")
		return
	}

	scheduledAt, err := time.Parse(time.RFC3339, req.ScheduledAt)
	if err != nil {
		scheduledAt, err = time.Parse(time.RFC3339Nano, req.ScheduledAt)
		if err != nil {
			writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid scheduledAt format")
			return
		}
	}

	var clientID *string
	if u, ok := userFromContext(r.Context()); ok && u.ID != "" {
		clientID = &u.ID
	}

	result, err := a.usecases.CreateAppointment(r.Context(), application.CreateAppointmentCommand{
		BranchID:          branchID,
		ServiceID:         req.ServiceID,
		ScheduledAt:       scheduledAt,
		IdempotencyKey:    idempotencyKey,
		ClientID:          clientID,
		NotificationEmail: strings.TrimSpace(req.Email),
		NotificationPhone: strings.TrimSpace(req.Phone),
	})
	if err != nil {
		if errors.Is(err, application.ErrInvalidState) {
			writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "scheduledAt must be in the future")
			return
		}
		a.respondError(w, r, err)
		return
	}

	status := http.StatusCreated
	if result.Replayed {
		status = http.StatusOK
	}

	writeJSONResponse(w, status, AppointmentResponse{
		Ticket:          mapTicket(result.Appointment.Ticket),
		ScheduledAt:     result.Appointment.ScheduledAt,
		ManagementToken: result.Appointment.Ticket.ManagementToken,
	})
}

func (a *API) CancelAppointment(w http.ResponseWriter, r *http.Request) {
	ticketID := chi.URLParam(r, "ticketId")
	user, isStaff := userFromContext(r.Context())
	isAuthorizedStaff := isStaff && (user.Role == domain.RoleEmployee || user.Role == domain.RoleOPCChief)
	isAuthenticatedClient := isStaff && user.ID != ""

	token := r.Header.Get("X-Ticket-Manage-Token")
	if !isAuthorizedStaff && !isAuthenticatedClient && strings.TrimSpace(token) == "" {
		writeJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "X-Ticket-Manage-Token header is required for cancellation")
		return
	}

	ctx := r.Context()
	if isAuthorizedStaff {
		ctx = persistence.WithStaffBypass(ctx)
	} else if isAuthenticatedClient {
		ctx = persistence.WithClientOwner(ctx, user.ID)
		if strings.TrimSpace(token) != "" {
			ctx = persistence.WithManagementToken(ctx, token)
		}
	} else {
		ctx = persistence.WithPublicClient(ctx)
		ctx = persistence.WithManagementToken(ctx, token)
	}

	appView, err := a.usecases.CancelAppointment(ctx, ticketID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	writeJSONResponse(w, http.StatusOK, AppointmentResponse{
		Ticket:      mapTicket(appView.Ticket),
		ScheduledAt: appView.ScheduledAt,
	})
}

func (a *API) CancelTicket(w http.ResponseWriter, r *http.Request) {
	ticketID := chi.URLParam(r, "ticketId")
	user, isStaff := userFromContext(r.Context())
	isAuthorizedStaff := isStaff && (user.Role == domain.RoleEmployee || user.Role == domain.RoleOPCChief)
	isAuthenticatedClient := isStaff && user.ID != ""

	token := r.Header.Get("X-Ticket-Manage-Token")
	if !isAuthorizedStaff && !isAuthenticatedClient && strings.TrimSpace(token) == "" {
		writeJSONError(w, r, http.StatusForbidden, "FORBIDDEN", "X-Ticket-Manage-Token header is required for cancellation")
		return
	}

	ctx := r.Context()
	if isAuthorizedStaff {
		ctx = persistence.WithStaffBypass(ctx)
	} else if isAuthenticatedClient {
		ctx = persistence.WithClientOwner(ctx, user.ID)
		if strings.TrimSpace(token) != "" {
			ctx = persistence.WithManagementToken(ctx, token)
		}
	} else {
		ctx = persistence.WithPublicClient(ctx)
		ctx = persistence.WithManagementToken(ctx, token)
	}

	ticket, err := a.usecases.CancelTicket(ctx, ticketID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	writeJSONResponse(w, http.StatusOK, mapTicket(ticket))
}

func (a *API) GetBranchWorkload(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	workload, err := a.usecases.GetBranchWorkload(r.Context(), branchID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	writeJSONResponse(w, http.StatusOK, workload)
}

func (a *API) ListMyActiveTickets(w http.ResponseWriter, r *http.Request) {
	user, ok := userFromContext(r.Context())
	if !ok || user.ID == "" {
		writeJSONResponse(w, http.StatusOK, map[string]any{"items": []TicketDTO{}})
		return
	}

	tickets, err := a.usecases.ListActiveTicketsByClient(r.Context(), user.ID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	items := make([]TicketDTO, len(tickets))
	for i, t := range tickets {
		items[i] = mapTicket(t)
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"items": items})
}

func (a *API) GetBranchReviews(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	reviews, err := a.usecases.ListBranchReviews(r.Context(), branchID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	if reviews == nil {
		reviews = []domain.RecentFeedback{}
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"items": reviews})
}


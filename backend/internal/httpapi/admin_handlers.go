package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

type ChangeWindowStatusRequest struct {
	Status string `json:"status"`
}

func (a *API) ListAnomalies(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := paginationParams(w, r)
	if !ok { return }
	page, err := a.usecases.ListAnomalies(r.Context(), chi.URLParam(r, "branchId"), limit, offset)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"items": page.Items, "total": page.Total, "limit": limit, "offset": offset,
	})
}

func (a *API) ChangeWindowStatus(w http.ResponseWriter, r *http.Request) {
	windowID := chi.URLParam(r, "windowId")

	var req ChangeWindowStatusRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Status == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}

	switch domain.WindowStatus(req.Status) {
	case domain.WindowStatusClosed, domain.WindowStatusOpen, domain.WindowStatusClosing:
		// valid
	default:
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR",
			"status must be one of CLOSED, OPEN, CLOSING")
		return
	}

	wnd, err := a.usecases.ChangeWindowStatus(r.Context(), windowID, domain.WindowStatus(req.Status))
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	services := make([]ServiceDTO, len(wnd.Services))
	for j, s := range wnd.Services {
		services[j] = ServiceDTO{ID: s.ID, Code: s.Code, Name: s.Name}
	}

	writeJSONResponse(w, http.StatusOK, WindowDTO{
		ID:       wnd.ID,
		Number:   wnd.Number,
		Status:   string(wnd.Status),
		Services: services,
	})
}

func (a *API) CreateWindow(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	wnd, err := a.usecases.CreateWindow(r.Context(), branchID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	writeJSONResponse(w, http.StatusCreated, mapWindowDTO(wnd))
}

func (a *API) DeleteWindow(w http.ResponseWriter, r *http.Request) {
	windowID := chi.URLParam(r, "windowId")
	if err := a.usecases.DeleteWindow(r.Context(), windowID); err != nil {
		a.respondError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type UpdateWindowServicesRequest struct {
	ServiceIDs []string `json:"serviceIds"`
}

// UpdateWindowServices persists the capability set of a window. Without this call the
// operator screen only edited browser state, so the next overview poll reverted it.
func (a *API) UpdateWindowServices(w http.ResponseWriter, r *http.Request) {
	windowID := chi.URLParam(r, "windowId")

	var req UpdateWindowServicesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.ServiceIDs) == 0 {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR",
			"serviceIds must contain at least one service")
		return
	}
	for _, serviceID := range req.ServiceIDs {
		if serviceID == "" {
			writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR",
				"serviceIds must not contain empty ids")
			return
		}
	}

	wnd, err := a.usecases.UpdateWindowServices(r.Context(), application.UpdateWindowServicesCommand{
		WindowID:   windowID,
		ServiceIDs: req.ServiceIDs,
	})
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	writeJSONResponse(w, http.StatusOK, mapWindowDTO(wnd))
}

func (a *API) GetAdminOverview(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	overview, err := a.usecases.GetAdminOverview(r.Context(), branchID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, overview)
}

func (a *API) SavePriorityRules(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	var rules []domain.PriorityRule
	if err := json.NewDecoder(r.Body).Decode(&rules); err != nil {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}
	err := a.usecases.SavePriorityRules(r.Context(), branchID, rules)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, rules)
}

type QueuePolicyDTO struct {
	BranchID                        string    `json:"branchId"`
	AppointmentDuePriority          int       `json:"appointmentDuePriority"`
	QRPriority                      int       `json:"qrPriority"`
	LivePriority                    int       `json:"livePriority"`
	AntiStarvationThresholdMinutes  int       `json:"antiStarvationThresholdMinutes"`
	AntiStarvationPointsPerMinute   int       `json:"antiStarvationPointsPerMinute"`
	AppointmentGraceMinutes         int       `json:"appointmentGraceMinutes"`
	AppointmentLatePenaltyPerMinute int       `json:"appointmentLatePenaltyPerMinute"`
	AppointmentLatePenaltyMaxPoints int       `json:"appointmentLatePenaltyMaxPoints"`
	Version                         int64     `json:"version"`
	UpdatedAt                       time.Time `json:"updatedAt"`

	ScheduledPromotionIntervalMinutes *int    `json:"scheduledPromotionIntervalMinutes,omitempty"`
	ScheduledAppointmentGraceMinutes  *int    `json:"scheduledAppointmentGraceMinutes,omitempty"`
	ScheduledEffectiveOn             *string `json:"scheduledEffectiveOn,omitempty"`
}

func (a *API) GetQueuePolicy(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	policy, err := a.usecases.GetQueuePolicy(r.Context(), branchID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, mapQueuePolicy(policy))
}

func mapQueuePolicy(policy domain.QueuePolicy) QueuePolicyDTO {
	dto := QueuePolicyDTO{
		BranchID:                          policy.BranchID,
		AppointmentDuePriority:            policy.AppointmentDuePriority,
		QRPriority:                        policy.QRPriority,
		LivePriority:                      policy.LivePriority,
		AntiStarvationThresholdMinutes:    policy.AntiStarvationThresholdMinutes,
		AntiStarvationPointsPerMinute:     policy.AntiStarvationPointsPerMinute,
		AppointmentGraceMinutes:           policy.AppointmentGraceMinutes,
		AppointmentLatePenaltyPerMinute:   policy.AppointmentLatePenaltyPerMinute,
		AppointmentLatePenaltyMaxPoints:   policy.AppointmentLatePenaltyMaxPoints,
		Version:                           policy.Version,
		UpdatedAt:                         policy.UpdatedAt,
		ScheduledPromotionIntervalMinutes: policy.ScheduledAntiStarvationThresholdMinutes,
		ScheduledAppointmentGraceMinutes:  policy.ScheduledAppointmentGraceMinutes,
	}
	if policy.ScheduledEffectiveDate != nil {
		eff := policy.ScheduledEffectiveDate.Format("2006-01-02")
		dto.ScheduledEffectiveOn = &eff
	}
	return dto
}

// Presence distinguishes an omitted legacy field from an explicit numeric zero.
// A pointer alone would conflate omitted and null, which the contract forbids.
type policyNumber[T ~int | ~int64] struct {
	Value   T
	Present bool
}

func (n *policyNumber[T]) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return errors.New("policy number cannot be null")
	}
	if err := json.Unmarshal(data, &n.Value); err != nil {
		return err
	}
	n.Present = true
	return nil
}

func (n policyNumber[T]) or(current T) T {
	if n.Present {
		return n.Value
	}
	return current
}

type UpdateQueuePolicyRequest struct {
	AppointmentDuePriority            policyNumber[int]   `json:"appointmentDuePriority"`
	QRPriority                        policyNumber[int]   `json:"qrPriority"`
	LivePriority                      policyNumber[int]   `json:"livePriority"`
	AntiStarvationThresholdMinutes    policyNumber[int]   `json:"antiStarvationThresholdMinutes"`
	ScheduledPromotionIntervalMinutes policyNumber[int]   `json:"scheduledPromotionIntervalMinutes"`
	AntiStarvationPointsPerMinute     policyNumber[int]   `json:"antiStarvationPointsPerMinute"`
	AppointmentGraceMinutes           policyNumber[int]   `json:"appointmentGraceMinutes"`
	ScheduledAppointmentGraceMinutes  policyNumber[int]   `json:"scheduledAppointmentGraceMinutes"`
	AppointmentLatePenaltyPerMinute   policyNumber[int]   `json:"appointmentLatePenaltyPerMinute"`
	AppointmentLatePenaltyMaxPoints   policyNumber[int]   `json:"appointmentLatePenaltyMaxPoints"`
	ExpectedVersion                   policyNumber[int64] `json:"expectedVersion"`
}

func (a *API) UpdateQueuePolicy(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")

	var req UpdateQueuePolicyRequest
	if err := decodeRequest(r, &req); err != nil || !req.ExpectedVersion.Present {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body")
		return
	}

	current, err := a.usecases.GetQueuePolicy(r.Context(), branchID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	if current.Version != req.ExpectedVersion.Value {
		a.respondError(w, r, application.ErrPolicyVersionConflict)
		return
	}

	promoInterval := req.ScheduledPromotionIntervalMinutes.or(req.AntiStarvationThresholdMinutes.or(current.AntiStarvationThresholdMinutes))
	grace := req.ScheduledAppointmentGraceMinutes.or(req.AppointmentGraceMinutes.or(current.AppointmentGraceMinutes))

	policy, err := a.usecases.UpdateQueuePolicy(r.Context(), application.UpdateQueuePolicyCommand{
		BranchID:                        branchID,
		AppointmentDuePriority:          req.AppointmentDuePriority.or(current.AppointmentDuePriority),
		QRPriority:                      req.QRPriority.or(current.QRPriority),
		LivePriority:                    req.LivePriority.or(current.LivePriority),
		AntiStarvationThresholdMinutes:  promoInterval,
		AntiStarvationPointsPerMinute:   req.AntiStarvationPointsPerMinute.or(current.AntiStarvationPointsPerMinute),
		AppointmentGraceMinutes:         grace,
		AppointmentLatePenaltyPerMinute: req.AppointmentLatePenaltyPerMinute.or(current.AppointmentLatePenaltyPerMinute),
		AppointmentLatePenaltyMaxPoints: req.AppointmentLatePenaltyMaxPoints.or(current.AppointmentLatePenaltyMaxPoints),
		ExpectedVersion:                 req.ExpectedVersion.Value,
	})
	if err != nil {
		if errors.Is(err, application.ErrInvalidState) {
			writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid queue policy values")
			return
		}
		a.respondError(w, r, err)
		return
	}

	writeJSONResponse(w, http.StatusOK, mapQueuePolicy(policy))
}

type ListTicketEventsResponse struct {
	Items []TicketEventDTO `json:"items"`
}

type TicketEventDTO struct {
	ID               int64     `json:"id"`
	Type             string    `json:"type"`
	FromStatus       *string   `json:"fromStatus"`
	ToStatus         string    `json:"toStatus"`
	WindowID         *string   `json:"windowId"`
	PolicyVersion    *int64    `json:"policyVersion"`
	DecisionPriority *int64    `json:"decisionPriority"`
	OccurredAt       time.Time `json:"occurredAt"`
}

func (a *API) ListTicketEvents(w http.ResponseWriter, r *http.Request) {
	ticketID := chi.URLParam(r, "ticketId")
	events, err := a.usecases.ListTicketEvents(r.Context(), ticketID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	items := make([]TicketEventDTO, len(events))
	for i, e := range events {
		var fromStatus *string
		if e.FromStatus != nil {
			s := string(*e.FromStatus)
			fromStatus = &s
		}
		items[i] = TicketEventDTO{
			ID:               e.ID,
			Type:             string(e.Type),
			FromStatus:       fromStatus,
			ToStatus:         string(e.ToStatus),
			WindowID:         e.WindowID,
			PolicyVersion:    e.PolicyVersion,
			DecisionPriority: e.DecisionPriority,
			OccurredAt:       e.OccurredAt,
		}
	}

	writeJSONResponse(w, http.StatusOK, ListTicketEventsResponse{
		Items: items,
	})
}

type UpdateBranchScheduleRequest struct {
	WorkHours string `json:"workHours"`
}

func (a *API) CloseShift(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	res, err := a.usecases.CloseShift(r.Context(), branchID)
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	writeJSONResponse(w, http.StatusOK, res)
}

func (a *API) UpdateBranchSchedule(w http.ResponseWriter, r *http.Request) {
	branchID := chi.URLParam(r, "branchId")
	var req UpdateBranchScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.WorkHours == "" {
		writeJSONError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "Invalid request body: workHours required")
		return
	}

	branch, err := a.usecases.UpdateBranchSchedule(r.Context(), branchID, req.WorkHours)
	if err != nil {
		a.respondError(w, r, err)
		return
	}

	writeJSONResponse(w, http.StatusOK, branch)
}

func (a *API) ListNotificationOutbox(w http.ResponseWriter, r *http.Request) {
	limit, offset, ok := paginationParams(w, r)
	if !ok {
		return
	}
	status := r.URL.Query().Get("status")
	items, total, err := a.usecases.ListNotificationOutbox(r.Context(), limit, offset, status)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	if items == nil {
		items = []domain.NotificationOutboxItem{}
	}
	writeJSONResponse(w, http.StatusOK, map[string]interface{}{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}


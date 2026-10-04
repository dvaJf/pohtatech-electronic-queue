package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func TestCreateAppointment_Sprint2(t *testing.T) {
	schedTime := time.Now().Add(1 * time.Hour).Truncate(time.Second)
	uc := &FakeUseCases{
		CreateAppointmentFunc: func(ctx context.Context, cmd application.CreateAppointmentCommand) (application.CreateAppointmentResult, error) {
			if cmd.IdempotencyKey == "conflict" {
				return application.CreateAppointmentResult{}, application.ErrIdempotencyConflict
			}
			return application.CreateAppointmentResult{
				Appointment: application.AppointmentView{
					Ticket: domain.Ticket{
						ID:             "t-app-1",
						PublicNumber:   "A-000001",
						BranchID:       cmd.BranchID,
						ServiceID:      cmd.ServiceID,
						Source:         domain.TicketSourceAppointment,
						Status:         domain.TicketStatusScheduled,
						CreatedAt:      schedTime.Add(-10 * time.Minute),
						QueueEnteredAt: schedTime,
						ScheduledAt:    &schedTime,
					},
					ScheduledAt: schedTime,
				},
				Replayed: cmd.IdempotencyKey == "replay",
			}, nil
		},
	}
	r := setupTest(uc)

	t.Run("success 201", func(t *testing.T) {
		body := `{"branchId":"b1","serviceId":"s1","scheduledAt":"` + schedTime.Format(time.RFC3339) + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/appointments", bytes.NewBufferString(body))
		req.Header.Set("Idempotency-Key", "k1")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
		}
		var res AppointmentResponse
		if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
			t.Fatal(err)
		}
		if res.Ticket.ID != "t-app-1" || res.Ticket.Status != "SCHEDULED" || res.Ticket.PublicNumber != "A-000001" {
			t.Fatalf("unexpected ticket: %+v", res.Ticket)
		}
	})

	t.Run("replay 200", func(t *testing.T) {
		body := `{"branchId":"b1","serviceId":"s1","scheduledAt":"` + schedTime.Format(time.RFC3339) + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/appointments", bytes.NewBufferString(body))
		req.Header.Set("Idempotency-Key", "replay")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("invalid scheduledAt", func(t *testing.T) {
		body := `{"branchId":"b1","serviceId":"s1","scheduledAt":"not-a-date"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/appointments", bytes.NewBufferString(body))
		req.Header.Set("Idempotency-Key", "k1")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("missing key", func(t *testing.T) {
		body := `{"branchId":"b1","serviceId":"s1","scheduledAt":"` + schedTime.Format(time.RFC3339) + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/appointments", bytes.NewBufferString(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	})

	t.Run("appointment conflict", func(t *testing.T) {
		body := `{"branchId":"b1","serviceId":"s1","scheduledAt":"` + schedTime.Format(time.RFC3339) + `"}`
		req := httptest.NewRequest(http.MethodPost, "/api/v1/appointments", bytes.NewBufferString(body))
		req.Header.Set("Idempotency-Key", "conflict")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", w.Code)
		}
	})
}

func TestCreateAppointmentBookingWindowValidation(t *testing.T) {
	uc := &FakeUseCases{
		CreateAppointmentFunc: func(context.Context, application.CreateAppointmentCommand) (application.CreateAppointmentResult, error) {
			return application.CreateAppointmentResult{}, fmt.Errorf("database details must not leak: %w", application.ErrAppointmentOutsideBookingWindow)
		},
	}
	r := setupTest(uc)
	body := `{"branchId":"b1","serviceId":"s1","scheduledAt":"2026-10-19T12:00:00+03:00"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/appointments", bytes.NewBufferString(body))
	req.Header.Set("Idempotency-Key", "out-of-window")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	var response ErrorResponse
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if response.Error.Code != "VALIDATION_ERROR" || response.Error.Message != "Запись доступна на ближайшие 14 дней." {
		t.Fatalf("expected safe Russian booking-window validation, got %+v", response.Error)
	}
}

func TestCancelAppointment_Sprint2(t *testing.T) {
	schedTime := time.Now().Add(1 * time.Hour).Truncate(time.Second)
	uc := &FakeUseCases{
		CancelAppointmentFunc: func(ctx context.Context, ticketID string) (application.AppointmentView, error) {
			if ticketID == "notfound" {
				return application.AppointmentView{}, application.ErrNotFound
			}
			if ticketID == "invalid" {
				return application.AppointmentView{}, application.ErrInvalidState
			}
			return application.AppointmentView{
				Ticket: domain.Ticket{
					ID:           ticketID,
					PublicNumber: "A-000001",
					Source:       domain.TicketSourceAppointment,
					Status:       domain.TicketStatusCancelled,
					ScheduledAt:  &schedTime,
				},
				ScheduledAt: schedTime,
			}, nil
		},
	}
	r := setupTest(uc)

	t.Run("cancel 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/appointments/t-app-1/cancel", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var res AppointmentResponse
		if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
			t.Fatal(err)
		}
		if res.Ticket.Status != "CANCELLED" {
			t.Fatalf("expected CANCELLED, got %s", res.Ticket.Status)
		}
	})

	t.Run("invalid cancel state", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/appointments/invalid/cancel", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", w.Code)
		}
	})

	t.Run("cancel not found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/appointments/notfound/cancel", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})
}

func TestCancelTicket_Sprint2(t *testing.T) {
	uc := &FakeUseCases{
		CancelTicketFunc: func(ctx context.Context, ticketID string) (domain.Ticket, error) {
			if ticketID == "notfound" {
				return domain.Ticket{}, application.ErrNotFound
			}
			if ticketID == "invalid" {
				return domain.Ticket{}, application.ErrInvalidState
			}
			return domain.Ticket{
				ID:           ticketID,
				PublicNumber: "Q-000001",
				Source:       domain.TicketSourceQR,
				Status:       domain.TicketStatusCancelled,
			}, nil
		},
	}
	r := setupTest(uc)

	t.Run("cancel 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/tickets/t-qr-1/cancel", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var res TicketDTO
		if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
			t.Fatal(err)
		}
		if res.Status != "CANCELLED" {
			t.Fatalf("expected CANCELLED, got %s", res.Status)
		}
		if res.PublicNumber != "Q-000001" {
			t.Fatalf("expected Q-000001, got %s", res.PublicNumber)
		}
	})

	t.Run("invalid cancel state", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/tickets/invalid/cancel", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", w.Code)
		}
	})

	t.Run("cancel not found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/tickets/notfound/cancel", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})
}

func TestQueuePolicy_Sprint2(t *testing.T) {
	now := time.Now().UTC()
	uc := &FakeUseCases{
		GetQueuePolicyFunc: func(ctx context.Context, branchID string) (domain.QueuePolicy, error) {
			if branchID == "notfound" {
				return domain.QueuePolicy{}, application.ErrNotFound
			}
			return domain.QueuePolicy{
				BranchID:               branchID,
				AppointmentDuePriority: 100,
				QRPriority:             10,
				Version:                1,
				UpdatedAt:              now,
			}, nil
		},
		UpdateQueuePolicyFunc: func(ctx context.Context, cmd application.UpdateQueuePolicyCommand) (domain.QueuePolicy, error) {
			// Core remains responsible for semantic policy validation.
			if cmd.AppointmentDuePriority <= cmd.QRPriority {
				return domain.QueuePolicy{}, application.ErrInvalidState
			}
			if cmd.ExpectedVersion == 999 {
				return domain.QueuePolicy{}, application.ErrPolicyVersionConflict
			}
			return domain.QueuePolicy{
				BranchID:               cmd.BranchID,
				AppointmentDuePriority: cmd.AppointmentDuePriority,
				QRPriority:             cmd.QRPriority,
				Version:                cmd.ExpectedVersion + 1,
				UpdatedAt:              now,
			}, nil
		},
	}
	r := setupTest(uc)

	t.Run("GET policy", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/branches/b1/queue-policy", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var p QueuePolicyDTO
		if err := json.NewDecoder(w.Body).Decode(&p); err != nil {
			t.Fatal(err)
		}
		if p.AppointmentDuePriority != 100 || p.QRPriority != 10 || p.Version != 1 {
			t.Fatalf("unexpected policy: %+v", p)
		}
	})

	t.Run("PUT policy", func(t *testing.T) {
		body := `{"appointmentDuePriority":200,"qrPriority":20,"expectedVersion":1}`
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/branches/b1/queue-policy", bytes.NewBufferString(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var p QueuePolicyDTO
		if err := json.NewDecoder(w.Body).Decode(&p); err != nil {
			t.Fatal(err)
		}
		if p.Version != 2 {
			t.Fatalf("expected version 2, got %d", p.Version)
		}
	})

	t.Run("version conflict", func(t *testing.T) {
		body := `{"appointmentDuePriority":200,"qrPriority":20,"expectedVersion":999}`
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/branches/b1/queue-policy", bytes.NewBufferString(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d: %s", w.Code, w.Body.String())
		}
	})

	t.Run("policy validation", func(t *testing.T) {
		body := `{"appointmentDuePriority":10,"qrPriority":100,"expectedVersion":1}`
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/branches/b1/queue-policy", bytes.NewBufferString(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	})
}

// TestWindowManagement_Sprint2 covers the window endpoints the operator and chief
// screens rely on: shift status and the persisted capability set. Both used to be
// browser-only edits, so the next overview poll reverted them.
func TestWindowManagement_Sprint2(t *testing.T) {
	const windowID = "33333333-3333-3333-3333-333333333333"
	parcels := domain.Service{ID: "22222222-2222-2222-2222-222222222222", Code: "PARCELS", Name: "Посылки"}
	send := domain.Service{ID: "33333333-2222-2222-2222-222222222222", Code: "SEND", Name: "Отправка писем и посылок"}

	uc := &FakeUseCases{
		ChangeWindowStatusFunc: func(ctx context.Context, id string, status domain.WindowStatus) (domain.Window, error) {
			if id != windowID {
				return domain.Window{}, application.ErrNotFound
			}
			return domain.Window{ID: id, Number: 1, Status: status, Services: []domain.Service{parcels}}, nil
		},
		UpdateWindowServicesFunc: func(ctx context.Context, cmd application.UpdateWindowServicesCommand) (domain.Window, error) {
			if cmd.WindowID != windowID {
				return domain.Window{}, application.ErrNotFound
			}
			// Since 000012 any requested capability set is accepted: ticket history no
			// longer pins a capability, so dropping a service always succeeds.
			services := make([]domain.Service, 0, len(cmd.ServiceIDs))
			for _, id := range cmd.ServiceIDs {
				switch id {
				case parcels.ID:
					services = append(services, parcels)
				case send.ID:
					services = append(services, send)
				}
			}
			return domain.Window{ID: cmd.WindowID, Number: 1, Status: domain.WindowStatusOpen, Services: services}, nil
		},
	}
	r := setupTest(uc)

	put := func(t *testing.T, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPut, path, bytes.NewBufferString(body))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}

	t.Run("close shift", func(t *testing.T) {
		w := put(t, "/api/v1/admin/windows/"+windowID+"/status", `{"status":"CLOSED"}`)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var wnd WindowDTO
		if err := json.NewDecoder(w.Body).Decode(&wnd); err != nil {
			t.Fatal(err)
		}
		if wnd.Status != string(domain.WindowStatusClosed) || wnd.Number != 1 || len(wnd.Services) != 1 {
			t.Fatalf("unexpected window: %+v", wnd)
		}
	})

	t.Run("open shift", func(t *testing.T) {
		w := put(t, "/api/v1/admin/windows/"+windowID+"/status", `{"status":"OPEN"}`)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var wnd WindowDTO
		if err := json.NewDecoder(w.Body).Decode(&wnd); err != nil {
			t.Fatal(err)
		}
		if wnd.Status != string(domain.WindowStatusOpen) {
			t.Fatalf("expected OPEN, got %s", wnd.Status)
		}
	})

	t.Run("unknown status rejected", func(t *testing.T) {
		w := put(t, "/api/v1/admin/windows/"+windowID+"/status", `{"status":"SLEEPING"}`)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	})

	t.Run("unknown window status", func(t *testing.T) {
		w := put(t, "/api/v1/admin/windows/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/status", `{"status":"OPEN"}`)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})

	t.Run("replace window services", func(t *testing.T) {
		body := `{"serviceIds":["22222222-2222-2222-2222-222222222222","33333333-2222-2222-2222-222222222222"]}`
		w := put(t, "/api/v1/admin/windows/"+windowID+"/services", body)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var wnd WindowDTO
		if err := json.NewDecoder(w.Body).Decode(&wnd); err != nil {
			t.Fatal(err)
		}
		if len(wnd.Services) != 2 {
			t.Fatalf("expected persisted capability set, got %+v", wnd.Services)
		}
	})

	t.Run("service with ticket history can be dropped", func(t *testing.T) {
		body := `{"serviceIds":["22222222-2222-2222-2222-222222222222"]}`
		w := put(t, "/api/v1/admin/windows/"+windowID+"/services", body)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var wnd WindowDTO
		if err := json.NewDecoder(w.Body).Decode(&wnd); err != nil {
			t.Fatal(err)
		}
		if len(wnd.Services) != 1 || wnd.Services[0].Code != "PARCELS" {
			t.Fatalf("expected PARCELS-only capability set, got %+v", wnd.Services)
		}
	})

	t.Run("empty capability set rejected", func(t *testing.T) {
		w := put(t, "/api/v1/admin/windows/"+windowID+"/services", `{"serviceIds":[]}`)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	})

	t.Run("unknown window services", func(t *testing.T) {
		body := `{"serviceIds":["22222222-2222-2222-2222-222222222222"]}`
		w := put(t, "/api/v1/admin/windows/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/services", body)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})
}

func TestTicketEvents_Sprint2(t *testing.T) {
	now := time.Now().UTC()
	v1 := int64(1)
	p100 := int64(100)
	fromSched := domain.TicketStatusScheduled
	uc := &FakeUseCases{
		ListTicketEventsFunc: func(ctx context.Context, ticketID string) ([]domain.TicketEvent, error) {
			if ticketID == "notfound" {
				return nil, application.ErrNotFound
			}
			return []domain.TicketEvent{
				{
					ID:         1,
					TicketID:   ticketID,
					Type:       domain.TicketEventCreated,
					ToStatus:   domain.TicketStatusScheduled,
					OccurredAt: now,
				},
				{
					ID:               2,
					TicketID:         ticketID,
					Type:             domain.TicketEventCalled,
					FromStatus:       &fromSched,
					ToStatus:         domain.TicketStatusCalled,
					PolicyVersion:    &v1,
					DecisionPriority: &p100,
					OccurredAt:       now.Add(1 * time.Minute),
				},
			}, nil
		},
	}
	r := setupTest(uc)

	t.Run("event list DTO", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/tickets/t1/events", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var res ListTicketEventsResponse
		if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
			t.Fatal(err)
		}
		if len(res.Items) != 2 {
			t.Fatalf("expected 2 events, got %d", len(res.Items))
		}
		if res.Items[1].PolicyVersion == nil || *res.Items[1].PolicyVersion != 1 {
			t.Fatalf("expected policyVersion 1, got %v", res.Items[1].PolicyVersion)
		}
	})

	t.Run("event not found", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/admin/tickets/notfound/events", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})
}

func TestBranchWorkload_Shift_Schedule(t *testing.T) {
	uc := &FakeUseCases{
		GetBranchWorkloadFunc: func(ctx context.Context, branchID string) (domain.BranchWorkload, error) {
			if branchID == "notfound" {
				return domain.BranchWorkload{}, application.ErrNotFound
			}
			return domain.BranchWorkload{
				BranchID:       branchID,
				CurrentHour:    14,
				CurrentWaiting: 3,
				SampleCount:    45,
				IsHistorical:   true,
				Hourly: []domain.HourlyWorkload{
					{Hour: 14, LoadPercent: 75, WaitMinutes: 15, IsPeak: true},
				},
			}, nil
		},
		CloseShiftFunc: func(ctx context.Context, branchID string) (domain.ShiftClosureResult, error) {
			if branchID == "notfound" {
				return domain.ShiftClosureResult{}, application.ErrNotFound
			}
			return domain.ShiftClosureResult{
				BranchID:              branchID,
				CancelledTicketsCount: 5,
				WindowsClosingCount:   2,
				WindowsClosedCount:    1,
			}, nil
		},
		UpdateBranchScheduleFunc: func(ctx context.Context, branchID string, workHours string) (domain.Branch, error) {
			if branchID == "notfound" {
				return domain.Branch{}, application.ErrNotFound
			}
			return domain.Branch{
				ID:        branchID,
				Name:      "Отделение №1",
				WorkHours: workHours,
			}, nil
		},
	}
	r := setupTest(uc)

	t.Run("workload 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/branches/b1/workload", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var res domain.BranchWorkload
		if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
			t.Fatal(err)
		}
		if res.BranchID != "b1" || res.CurrentWaiting != 3 || len(res.Hourly) != 1 {
			t.Fatalf("unexpected workload result: %+v", res)
		}
	})

	t.Run("close shift 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/admin/branches/b1/close-shift", nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var res domain.ShiftClosureResult
		if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
			t.Fatal(err)
		}
		if res.CancelledTicketsCount != 5 || res.WindowsClosingCount != 2 {
			t.Fatalf("unexpected shift result: %+v", res)
		}
	})

	t.Run("update schedule 200", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPut, "/api/v1/admin/branches/b1/schedule", bytes.NewBufferString(`{"workHours":"09:00–21:00"}`))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var res domain.Branch
		if err := json.NewDecoder(w.Body).Decode(&res); err != nil {
			t.Fatal(err)
		}
		if res.WorkHours != "09:00–21:00" {
			t.Fatalf("expected 09:00–21:00, got %s", res.WorkHours)
		}
	})
}

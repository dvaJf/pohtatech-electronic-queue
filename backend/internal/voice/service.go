package voice

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"sort"
	"strings"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

type VoiceService struct {
	usecases application.UseCases
	sessions SessionStore
	logger   *slog.Logger
}

func NewVoiceService(usecases application.UseCases, sessions SessionStore, logger *slog.Logger) *VoiceService {
	if sessions == nil {
		sessions = NewMemorySessionStore()
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &VoiceService{
		usecases: usecases,
		sessions: sessions,
		logger:   logger,
	}
}

func (s *VoiceService) HandleRequest(ctx context.Context, req VoiceRequest) (VoiceResponse, error) {
	// 1. Resolve or create user from external Yandex account
	user := s.resolveUser(ctx, req)

	// 2. Resolve active pending action (from request session_state or server session store)
	pendingAction := req.PendingAction
	if pendingAction == nil && req.SessionID != "" {
		if act, ok := s.sessions.GetPendingAction(req.SessionID); ok {
			pendingAction = act
		}
	}

	// 3. Dispatch by intent
	switch req.Intent {
	case IntentConfirm:
		return s.handleConfirm(ctx, req, user, pendingAction)

	case IntentReject:
		return s.handleReject(ctx, req)

	case IntentTakeTicket:
		return s.handleTakeTicket(ctx, req, user)

	case IntentBookAppointment:
		return s.handleBookAppointment(ctx, req, user)

	case IntentTicketStatus:
		return s.handleTicketStatus(ctx, req, user)

	case IntentCancelTicket:
		return s.handleCancelTicket(ctx, req, user)

	case IntentFastestBranch:
		return s.handleFastestBranch(ctx, req, user)

	case IntentNearestBranch:
		return s.handleNearestBranch(ctx, req, user)

	case IntentHelp:
		return s.handleHelp()

	default:
		return s.handleHelp()
	}
}

func (s *VoiceService) resolveUser(ctx context.Context, req VoiceRequest) domain.User {
	extID := req.UserID
	if extID == "" {
		extID = req.ApplicationID
	}
	if extID == "" {
		extID = "anonymous_alice_user"
	}

	u, err := s.usecases.GetOrCreateExternalUser(ctx, "yandex_alice", extID)
	if err != nil {
		s.logger.WarnContext(ctx, "failed to get or create external voice user", "error", err, "ext_id", extID)
		return domain.User{
			ID:        "00000000-0000-0000-0000-000000000001",
			Email:     "alice_" + extID + "@alice.yandex.ru",
			Role:      domain.RoleClient,
			Confirmed: true,
		}
	}
	return u
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIRM ("Да")
// ─────────────────────────────────────────────────────────────────────────────

func (s *VoiceService) handleConfirm(ctx context.Context, req VoiceRequest, user domain.User, pending *PendingAction) (VoiceResponse, error) {
	if pending == nil || time.Now().After(pending.ExpiresAt) {
		if req.SessionID != "" {
			s.sessions.ClearPendingAction(req.SessionID)
		}
		return VoiceResponse{
			Text: "Нет действия для подтверждения. Чем могу помочь? Вы можете сказать: «Запиши меня на почту» или «Запиши на 15:30».",
			Buttons: []string{"Запиши меня на почту", "Запиши на 15:30", "Где быстрее?"},
		}, nil
	}

	switch pending.Type {
	case ActionTakeTicket:
		idempotencyKey := fmt.Sprintf("alice:live:%s:%s", req.SessionID, req.RequestID)
		res, err := s.usecases.CreateLiveTicket(ctx, application.CreateLiveTicketCommand{
			BranchID:       pending.BranchID,
			ServiceID:      pending.ServiceID,
			IdempotencyKey: idempotencyKey,
			ClientID:       &user.ID,
		})
		if err != nil {
			s.logger.ErrorContext(ctx, "failed to create live ticket from voice", "error", err, "branch_id", pending.BranchID)
			return VoiceResponse{
				Text: "К сожалению, не удалось взять талон в этом отделении. Попробуйте выбрать другое отделение.",
				Buttons: []string{"Где быстрее?", "Где ближайшая почта?"},
			}, nil
		}

		if req.SessionID != "" {
			s.sessions.ClearPendingAction(req.SessionID)
		}

		// Queue position info
		pos, err := s.usecases.GetQueuePosition(ctx, res.Ticket.ID)
		peopleAhead := 0
		waitMinutes := 5
		if err == nil && pos.Position != nil {
			peopleAhead = *pos.Position - 1
			if peopleAhead < 0 {
				peopleAhead = 0
			}
			waitMinutes = peopleAhead*4 + 3
		}

		return VoiceResponse{
			Text: fmt.Sprintf("Готово! Ваш талон %s в отделение %s. Перед вами %d %s. Ожидание около %d минут.",
				res.Ticket.PublicNumber, pending.BranchName, peopleAhead, pluralPeople(peopleAhead), waitMinutes),
			Buttons: []string{"Сколько мне осталось?", "Отмени запись"},
		}, nil

	case ActionBookAppointment:
		scheduledAt := time.Now().Add(1 * time.Hour)
		if pending.ScheduledAt != nil {
			scheduledAt = *pending.ScheduledAt
		}
		idempotencyKey := fmt.Sprintf("alice:apt:%s:%s", req.SessionID, req.RequestID)
		res, err := s.usecases.CreateAppointment(ctx, application.CreateAppointmentCommand{
			BranchID:       pending.BranchID,
			ServiceID:      pending.ServiceID,
			ScheduledAt:    scheduledAt,
			IdempotencyKey: idempotencyKey,
			ClientID:       &user.ID,
		})
		if err != nil {
			s.logger.ErrorContext(ctx, "failed to create appointment from voice", "error", err, "branch_id", pending.BranchID)
			return VoiceResponse{
				Text: "Не удалось записать на это время. Возможно, время уже занято или отделение закрыто. Попробуйте другое время.",
				Buttons: []string{"Запиши на другое время", "Где быстрее?"},
			}, nil
		}

		if req.SessionID != "" {
			s.sessions.ClearPendingAction(req.SessionID)
		}

		timeStr := formatRussianTime(scheduledAt)
		return VoiceResponse{
			Text: fmt.Sprintf("Готово! Вы записаны на %s в отделение %s. Ваш номер талона: %s. Пожалуйста, приходите за 15 минут до времени записи.",
				timeStr, pending.BranchName, res.Appointment.Ticket.PublicNumber),
			Buttons: []string{"Мой талон", "Отмени запись"},
		}, nil

	case ActionCancelTicket:
		_, _ = s.usecases.CancelTicket(ctx, pending.TicketID)
		_, _ = s.usecases.CancelAppointment(ctx, pending.TicketID)

		if req.SessionID != "" {
			s.sessions.ClearPendingAction(req.SessionID)
		}

		return VoiceResponse{
			Text: fmt.Sprintf("Талон %s успешно отменён. Чем ещё могу помочь?", pending.PublicNumber),
			Buttons: []string{"Запиши меня на почту", "Запиши на 15:30", "Где быстрее?"},
		}, nil
	}

	return s.handleHelp()
}

// ─────────────────────────────────────────────────────────────────────────────
// REJECT ("Нет", "Отмена")
// ─────────────────────────────────────────────────────────────────────────────

func (s *VoiceService) handleReject(ctx context.Context, req VoiceRequest) (VoiceResponse, error) {
	if req.SessionID != "" {
		s.sessions.ClearPendingAction(req.SessionID)
	}
	return VoiceResponse{
		Text: "Хорошо, действие отменено. Чем ещё могу помочь?",
		Buttons: []string{"Запиши меня на почту", "Запиши на 15:30", "Где быстрее?"},
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// TAKE_TICKET ("Запиши меня на почту")
// ─────────────────────────────────────────────────────────────────────────────

func (s *VoiceService) handleTakeTicket(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
	// Check if customer already has active ticket
	if active, err := s.usecases.FindActiveTicketByClient(ctx, user.ID); err == nil && active != nil {
		pos, _ := s.usecases.GetQueuePosition(ctx, active.ID)
		ahead := 0
		if pos.Position != nil && *pos.Position > 1 {
			ahead = *pos.Position - 1
		}
		waitMins := ahead*4 + 3
		branchName := "отделении"
		if b, bErr := s.findBranchByID(ctx, active.BranchID); bErr == nil {
			branchName = b.Name
		}
		return VoiceResponse{
			Text: fmt.Sprintf("У вас уже есть активный талон %s в %s. Перед вами %d %s, примерное ожидание ~%d минут.",
				active.PublicNumber, branchName, ahead, pluralPeople(ahead), waitMins),
			Buttons: []string{"Сколько мне осталось?", "Отмени запись"},
		}, nil
	}

	candidates, err := s.rankBranches(ctx, req.Location, req.Slots["street"])
	if err != nil || len(candidates) == 0 {
		return VoiceResponse{
			Text: "Сейчас не удалось найти открытое отделение поблизости. Попробуйте позже.",
			Buttons: []string{"Где ближайшая почта?", "Помощь"},
		}, nil
	}

	best := candidates[0]
	serviceID := s.resolveDefaultServiceID(ctx, best.Branch.ID)

	pending := &PendingAction{
		Type:        ActionTakeTicket,
		BranchID:    best.Branch.ID,
		BranchName:  best.Branch.Name,
		ServiceID:   serviceID,
		ExpiresAt:   time.Now().Add(10 * time.Minute),
	}
	if req.SessionID != "" {
		s.sessions.SetPendingAction(req.SessionID, pending, 10*time.Minute)
	}

	return VoiceResponse{
		Text: fmt.Sprintf("Лучший вариант — %s (%s). Дорога около %d минут, очередь около %d минут. Всего примерно %d минут. Взять талон?",
			best.Branch.Name, best.Branch.Address, best.TravelMinutes, best.QueueMinutes, best.TotalMinutes),
		RequiresConfirmation: true,
		PendingAction:        pending,
		Buttons:              []string{"Да, взять талон", "Нет"},
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOK_APPOINTMENT ("Запиши меня на 15:30", "Запиши на завтра в 14:00")
// ─────────────────────────────────────────────────────────────────────────────

func (s *VoiceService) handleBookAppointment(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
	scheduledAt := req.ScheduledAt
	if scheduledAt == nil {
		return VoiceResponse{
			Text: "На какое время вас записать? Например: «на 15:30» или «на завтра в 11:00».",
			Buttons: []string{"На 14:00", "На 15:30", "На завтра в 10:00"},
		}, nil
	}

	candidates, err := s.rankBranches(ctx, req.Location, req.Slots["street"])
	if err != nil || len(candidates) == 0 {
		return VoiceResponse{
			Text: "Не удалось найти подходящее отделение для записи. Попробуйте позже.",
		}, nil
	}

	best := candidates[0]
	serviceID := s.resolveDefaultServiceID(ctx, best.Branch.ID)

	pending := &PendingAction{
		Type:        ActionBookAppointment,
		BranchID:    best.Branch.ID,
		BranchName:  best.Branch.Name,
		ServiceID:   serviceID,
		ScheduledAt: scheduledAt,
		ExpiresAt:   time.Now().Add(10 * time.Minute),
	}
	if req.SessionID != "" {
		s.sessions.SetPendingAction(req.SessionID, pending, 10*time.Minute)
	}

	timeStr := formatRussianTime(*scheduledAt)
	return VoiceResponse{
		Text: fmt.Sprintf("Записать вас на %s в %s (%s)? Дорога займет около %d минут. Подтверждаете?",
			timeStr, best.Branch.Name, best.Branch.Address, best.TravelMinutes),
		RequiresConfirmation: true,
		PendingAction:        pending,
		Buttons:              []string{"Да, записать", "Нет"},
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// TICKET_STATUS ("Сколько мне осталось?")
// ─────────────────────────────────────────────────────────────────────────────

func (s *VoiceService) handleTicketStatus(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
	active, err := s.usecases.FindActiveTicketByClient(ctx, user.ID)
	if err != nil || active == nil {
		return VoiceResponse{
			Text: "У вас сейчас нет активного талона. Хотите взять талон или записаться ко времени?",
			Buttons: []string{"Запиши меня на почту", "Запиши на 15:30", "Где быстрее?"},
		}, nil
	}

	branchName := "отделении"
	if b, bErr := s.findBranchByID(ctx, active.BranchID); bErr == nil {
		branchName = b.Name
	}

	if active.Status == domain.TicketStatusCalled && active.Window != nil {
		return VoiceResponse{
			Text: fmt.Sprintf("Ваш талон %s вызван в %s к окну %d! Пожалуйста, подойдите к окну обслуживания.",
				active.PublicNumber, branchName, active.Window.Number),
			Buttons: []string{"Спасибо"},
		}, nil
	}

	if active.Status == domain.TicketStatusScheduled && active.ScheduledAt != nil {
		timeStr := formatRussianTime(*active.ScheduledAt)
		return VoiceResponse{
			Text: fmt.Sprintf("Ваш талон %s записан на %s в %s. Пожалуйста, приходите за 15 минут до назначенного времени.",
				active.PublicNumber, timeStr, branchName),
			Buttons: []string{"Отмени запись", "Где быстрее?"},
		}, nil
	}

	pos, err := s.usecases.GetQueuePosition(ctx, active.ID)
	ahead := 0
	if err == nil && pos.Position != nil && *pos.Position > 1 {
		ahead = *pos.Position - 1
	}
	waitMins := ahead*4 + 3

	return VoiceResponse{
		Text: fmt.Sprintf("Ваш талон %s в %s. Статус: в очереди. Перед вами %d %s, примерное время ожидания — около %d минут.",
			active.PublicNumber, branchName, ahead, pluralPeople(ahead), waitMins),
		Buttons: []string{"Отмени запись", "Где быстрее?"},
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL_TICKET ("Отмени запись")
// ─────────────────────────────────────────────────────────────────────────────

func (s *VoiceService) handleCancelTicket(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
	active, err := s.usecases.FindActiveTicketByClient(ctx, user.ID)
	if err != nil || active == nil {
		return VoiceResponse{
			Text: "У вас нет активного талона, который можно отменить.",
			Buttons: []string{"Запиши меня на почту", "Запиши на 15:30"},
		}, nil
	}

	branchName := "отделении"
	if b, bErr := s.findBranchByID(ctx, active.BranchID); bErr == nil {
		branchName = b.Name
	}

	pending := &PendingAction{
		Type:         ActionCancelTicket,
		TicketID:     active.ID,
		PublicNumber: active.PublicNumber,
		BranchName:   branchName,
		ExpiresAt:    time.Now().Add(10 * time.Minute),
	}
	if req.SessionID != "" {
		s.sessions.SetPendingAction(req.SessionID, pending, 10*time.Minute)
	}

	return VoiceResponse{
		Text: fmt.Sprintf("У вас активен талон %s в %s. Действительно отменить запись?",
			active.PublicNumber, branchName),
		RequiresConfirmation: true,
		PendingAction:        pending,
		Buttons:              []string{"Да, отменить", "Нет, оставить"},
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// FASTEST_BRANCH / NEAREST_BRANCH
// ─────────────────────────────────────────────────────────────────────────────

func (s *VoiceService) handleFastestBranch(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
	candidates, err := s.rankBranches(ctx, req.Location, req.Slots["street"])
	if err != nil || len(candidates) == 0 {
		return VoiceResponse{Text: "Не удалось найти доступные отделения."}, nil
	}

	best := candidates[0]
	serviceID := s.resolveDefaultServiceID(ctx, best.Branch.ID)

	pending := &PendingAction{
		Type:       ActionTakeTicket,
		BranchID:   best.Branch.ID,
		BranchName: best.Branch.Name,
		ServiceID:  serviceID,
		ExpiresAt:  time.Now().Add(10 * time.Minute),
	}
	if req.SessionID != "" {
		s.sessions.SetPendingAction(req.SessionID, pending, 10*time.Minute)
	}

	return VoiceResponse{
		Text: fmt.Sprintf("Быстрее всего сейчас отделение %s (%s). Дорога ~%d минут, очередь ~%d минут. Всего примерно %d минут. Взять талон?",
			best.Branch.Name, best.Branch.Address, best.TravelMinutes, best.QueueMinutes, best.TotalMinutes),
		RequiresConfirmation: true,
		PendingAction:        pending,
		Buttons:              []string{"Да, взять талон", "Нет"},
	}, nil
}

func (s *VoiceService) handleNearestBranch(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
	candidates, err := s.rankBranches(ctx, req.Location, req.Slots["street"])
	if err != nil || len(candidates) == 0 {
		return VoiceResponse{Text: "Не удалось найти доступные отделения."}, nil
	}

	// Sort by physical distance
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].DistanceKm < candidates[j].DistanceKm
	})
	nearest := candidates[0]
	serviceID := s.resolveDefaultServiceID(ctx, nearest.Branch.ID)

	pending := &PendingAction{
		Type:       ActionTakeTicket,
		BranchID:   nearest.Branch.ID,
		BranchName: nearest.Branch.Name,
		ServiceID:  serviceID,
		ExpiresAt:  time.Now().Add(10 * time.Minute),
	}
	if req.SessionID != "" {
		s.sessions.SetPendingAction(req.SessionID, pending, 10*time.Minute)
	}

	return VoiceResponse{
		Text: fmt.Sprintf("Ближайшее отделение — %s на %s. Расстояние около %.1f км, дорога ~%d минут, очередь ~%d минут. Взять талон?",
			nearest.Branch.Name, nearest.Branch.Address, nearest.DistanceKm, nearest.TravelMinutes, nearest.QueueMinutes),
		RequiresConfirmation: true,
		PendingAction:        pending,
		Buttons:              []string{"Да, взять талон", "Нет"},
	}, nil
}

func (s *VoiceService) handleHelp() (VoiceResponse, error) {
	return VoiceResponse{
		Text: "Я помогу записаться на почту или подобрать удобное время. Вы можете сказать:\n— «Запиши меня на почту»\n— «Запиши на завтра в 14:00»\n— «Где быстрее?»\n— «Сколько мне осталось ждать?»\n— «Отмени запись»",
		Buttons: []string{"Запиши меня на почту", "Запиши на 15:30", "Где быстрее?", "Сколько мне ждать?"},
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch Ranking & Helpers
// ─────────────────────────────────────────────────────────────────────────────

func (s *VoiceService) rankBranches(ctx context.Context, loc *UserLocation, streetQuery string) ([]BranchCandidate, error) {
	branches, err := s.usecases.ListBranches(ctx)
	if err != nil {
		return nil, err
	}
	if len(branches) == 0 {
		return nil, nil
	}

	// Default Moscow coordinates if location unknown
	userLat := 55.7558
	userLng := 37.6173
	if loc != nil && loc.Latitude != 0 && loc.Longitude != 0 {
		userLat = loc.Latitude
		userLng = loc.Longitude
	}

	// If user explicitly named a street or branch, filter by match
	var matchedBranch *domain.Branch
	if streetQuery != "" {
		matchedBranch = MatchBranchByQuery(branches, streetQuery)
	}

	var candidates []BranchCandidate
	for _, b := range branches {
		if matchedBranch != nil && b.ID != matchedBranch.ID {
			continue
		}

		bLat := userLat
		bLng := userLng
		if b.Latitude != nil && b.Longitude != nil {
			bLat = *b.Latitude
			bLng = *b.Longitude
		}

		distKm := HaversineDistanceKm(userLat, userLng, bLat, bLng)
		travelMins := CalculateTravelMinutes(distKm)

		// Queue wait time estimate
		queueMins := 5
		if workload, wErr := s.usecases.GetBranchWorkload(ctx, b.ID); wErr == nil {
			if workload.EstimatedWaitSeconds != nil && *workload.EstimatedWaitSeconds > 0 {
				queueMins = (*workload.EstimatedWaitSeconds + 30) / 60
			} else if workload.CurrentWaiting > 0 {
				win := workload.ActiveWindows
				if win < 1 {
					win = 1
				}
				queueMins = (workload.CurrentWaiting * 5) / win
			}
		}

		candidates = append(candidates, BranchCandidate{
			Branch:        b,
			DistanceKm:    math.Round(distKm*10) / 10,
			TravelMinutes: travelMins,
			QueueMinutes:  queueMins,
			TotalMinutes:  travelMins + queueMins,
		})
	}

	// Sort ascending by TotalMinutes (fastest first)
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].TotalMinutes < candidates[j].TotalMinutes
	})

	return candidates, nil
}

func (s *VoiceService) resolveDefaultServiceID(ctx context.Context, branchID string) string {
	services, err := s.usecases.ListBranchServices(ctx, branchID)
	if err == nil && len(services) > 0 {
		// Prefer parcel / postal services if present
		for _, srv := range services {
			lower := strings.ToLower(srv.Name + " " + srv.Code)
			if strings.Contains(lower, "посылк") || strings.Contains(lower, "parcel") {
				return srv.ID
			}
		}
		return services[0].ID
	}
	return "00000000-0000-0000-0000-000000000002"
}

func (s *VoiceService) findBranchByID(ctx context.Context, branchID string) (domain.Branch, error) {
	branches, err := s.usecases.ListBranches(ctx)
	if err != nil {
		return domain.Branch{}, err
	}
	for _, b := range branches {
		if b.ID == branchID {
			return b, nil
		}
	}
	return domain.Branch{Name: "отделении Почты"}, nil
}

func formatRussianTime(t time.Time) string {
	msk := time.FixedZone("MSK", 3*3600)
	tMSK := t.In(msk)
	nowMSK := time.Now().In(msk)

	timePart := tMSK.Format("15:04")
	if tMSK.Year() == nowMSK.Year() && tMSK.YearDay() == nowMSK.YearDay() {
		return fmt.Sprintf("сегодня в %s", timePart)
	}
	tomorrow := nowMSK.AddDate(0, 0, 1)
	if tMSK.Year() == tomorrow.Year() && tMSK.YearDay() == tomorrow.YearDay() {
		return fmt.Sprintf("завтра в %s", timePart)
	}

	months := []string{"", "января", "февраля", "марта", "апреля", "мая", "июня",
		"июля", "августа", "сентября", "октября", "ноября", "декабря"}
	m := int(tMSK.Month())
	if m < 1 || m > 12 {
		m = 1
	}
	return fmt.Sprintf("%d %s в %s", tMSK.Day(), months[m], timePart)
}

func pluralPeople(n int) string {
	abs := n
	if abs < 0 {
		abs = -abs
	}
	rem100 := abs % 100
	rem10 := abs % 10
	if rem100 >= 11 && rem100 <= 19 {
		return "человек"
	}
	if rem10 == 1 {
		return "человек"
	}
	if rem10 >= 2 && rem10 <= 4 {
		return "человека"
	}
	return "человек"
}

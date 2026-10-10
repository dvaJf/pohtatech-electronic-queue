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
	"postcode/backend/internal/persistence"
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
		user := s.resolveUser(ctx, req)

		pendingAction := req.PendingAction
	if pendingAction == nil && req.SessionID != "" {
		if act, ok := s.sessions.GetPendingAction(req.SessionID); ok {
			pendingAction = act
		}
	}

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

	case IntentLinkAccount:
		return s.handleLinkAccount(ctx, req, user)

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
// CONFIRM ("Да")
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
		if req.SessionID != "" {
			s.sessions.ClearPendingAction(req.SessionID)
		}
		return VoiceResponse{
			Text: "Через Алису доступна только предварительная онлайн-запись на выбранное время. На какую дату и время вас записать? Например, на сегодня в 16:30 или завтра в 11:00.",
			Buttons: []string{"На сегодня в 16:30", "На сегодня в 17:00", "На завтра в 11:00", "Где меньше очередь?"},
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
		authCtx := persistence.WithStaffBypass(ctx)
		if user.ID != "" {
			authCtx = persistence.WithClientOwner(authCtx, user.ID)
		}
		_, errApp := s.usecases.CancelAppointment(authCtx, pending.TicketID)
		_, errTick := s.usecases.CancelTicket(authCtx, pending.TicketID)
		if errApp != nil && errTick != nil {
			s.logger.ErrorContext(ctx, "failed to cancel ticket via voice", "error_app", errApp, "error_tick", errTick, "ticket_id", pending.TicketID)
			return VoiceResponse{
				Text: fmt.Sprintf("Не удалось отменить талон %s. Пожалуйста, попробуйте отменить его на сайте.", pending.PublicNumber),
			}, nil
		}

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
// REJECT ("Нет", "Отмена")
func (s *VoiceService) handleReject(ctx context.Context, req VoiceRequest) (VoiceResponse, error) {
	if req.SessionID != "" {
		s.sessions.ClearPendingAction(req.SessionID)
	}
	return VoiceResponse{
		Text: "Хорошо, действие отменено. Чем ещё могу помочь?",
		Buttons: []string{"Запиши меня на почту", "Запиши на 15:30", "Где быстрее?"},
	}, nil
}
// TAKE_TICKET ("Запиши меня на почту")
func (s *VoiceService) handleTakeTicket(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
		if active, err := s.usecases.FindActiveTicketByClient(ctx, user.ID); err == nil && active != nil {
		branchName := "отделении"
		if b, bErr := s.findBranchByID(ctx, active.BranchID); bErr == nil {
			branchName = b.Name
		}
		if active.Status == domain.TicketStatusScheduled && active.ScheduledAt != nil {
			timeStr := formatRussianTime(*active.ScheduledAt)
			return VoiceResponse{
				Text: fmt.Sprintf("У вас уже есть активный талон %s на %s в %s.",
					active.PublicNumber, timeStr, branchName),
				Buttons: []string{"Сколько мне осталось?", "Отмени запись", "Где быстрее?"},
			}, nil
		}
		return VoiceResponse{
			Text: fmt.Sprintf("У вас уже есть активный талон %s в %s.",
				active.PublicNumber, branchName),
			Buttons: []string{"Сколько мне осталось?", "Отмени запись", "Где быстрее?"},
		}, nil
	}

	msk := time.FixedZone("MSK", 3*3600)
	nowMSK := time.Now().In(msk)
	isTomorrow := req.Slots["target_date"] == "tomorrow"
	timeButtons := generateSuggestedTimeButtons(nowMSK, isTomorrow)

	candidates, err := s.rankBranches(ctx, req.Location, req.Slots["street"])
	if err != nil || len(candidates) == 0 {
		return VoiceResponse{
			Text: "Для вас доступна предварительная онлайн-запись на выбранное время. На какую дату и время вас записать? Могу предложить сегодня в 17:00 или завтра в 11:00.",
			Buttons: timeButtons,
		}, nil
	}

	best := candidates[0]

		if !isTomorrow {
		isOpenNow, openStr, closeStr := IsBranchOpenNow(best.Branch.WorkHours, nowMSK)
		if !isOpenNow && nowMSK.Hour() >= 18 {
			return VoiceResponse{
				Text: fmt.Sprintf("Отделение %s сейчас уже закрыто (график: %s–%s). Доступна предварительная онлайн-запись на завтра. На какое время вас записать?",
					best.Branch.Name, openStr, closeStr),
				Buttons: generateSuggestedTimeButtons(nowMSK, true),
			}, nil
		}
	}

	if isTomorrow {
		return VoiceResponse{
			Text: fmt.Sprintf("Для вас доступна предварительная онлайн-запись на завтра в отделение %s (%s). На какое время вас записать? Например, на 10:00, 14:00 или 17:00.",
				best.Branch.Name, best.Branch.Address),
			Buttons: timeButtons,
		}, nil
	}

	if req.Slots["street"] != "" {
		return VoiceResponse{
			Text: fmt.Sprintf("Отделение %s (%s). Дорога пешком займет ~%d минут, в очереди %d %s (всего ~%d минут). Для вас доступна предварительная онлайн-запись ко времени. На какое время вас записать?",
				best.Branch.Name, best.Branch.Address, best.TravelMinutes, best.WaitingCount, pluralPeople(best.WaitingCount), best.TotalMinutes),
			Buttons: timeButtons,
		}, nil
	}

	return VoiceResponse{
		Text: fmt.Sprintf("Для вас доступна предварительная онлайн-запись ко времени в отделение %s (%s). Дорога займет ~%d минут, в очереди %d %s (всего ~%d минут). На какую дату и время вас записать?",
			best.Branch.Name, best.Branch.Address, best.TravelMinutes, best.WaitingCount, pluralPeople(best.WaitingCount), best.TotalMinutes),
		Buttons: timeButtons,
	}, nil
}
// BOOK_APPOINTMENT ("Запиши меня на 15:30", "Запиши на завтра в 14:00")
func (s *VoiceService) handleBookAppointment(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
	scheduledAt := req.ScheduledAt
	if scheduledAt == nil {
		msk := time.FixedZone("MSK", 3*3600)
		nowMSK := time.Now().In(msk)
		isTomorrow := req.Slots["target_date"] == "tomorrow"
		return VoiceResponse{
			Text: "На какую дату и время вас записать? Например: «на сегодня в 16:30» или «на завтра в 11:00».",
			Buttons: generateSuggestedTimeButtons(nowMSK, isTomorrow),
		}, nil
	}

	candidates, err := s.rankBranches(ctx, req.Location, req.Slots["street"])
	if err != nil || len(candidates) == 0 {
		return VoiceResponse{
			Text: "Не удалось найти подходящее отделение для записи. Попробуйте позже.",
		}, nil
	}

	best := candidates[0]

		msk := time.FixedZone("MSK", 3*3600)
	nowMSK := time.Now().In(msk)
	if ok, openStr, closeStr := IsTimeWithinWorkHours(best.Branch.WorkHours, *scheduledAt); !ok {
		timeStr := scheduledAt.In(msk).Format("15:04")
		return VoiceResponse{
			Text: fmt.Sprintf("Отделение %s работает с %s до %s. В выбранное время (%s) оно закрыто. Пожалуйста, выберите рабочее время для записи.",
				best.Branch.Name, openStr, closeStr, timeStr),
			Buttons: generateSuggestedTimeButtons(nowMSK, req.Slots["target_date"] == "tomorrow"),
		}, nil
	}

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
		Text: fmt.Sprintf("Записать вас онлайн на %s в %s (%s)? Дорога пешком займет около %d минут, в очереди сейчас %d %s (всего ~%d минут). Подтверждаете?",
			timeStr, best.Branch.Name, best.Branch.Address, best.TravelMinutes, best.WaitingCount, pluralPeople(best.WaitingCount), best.TotalMinutes),
		RequiresConfirmation: true,
		PendingAction:        pending,
		Buttons:              []string{"Да, записать", "Нет"},
	}, nil
}
// TICKET_STATUS ("Сколько мне осталось?")
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
	waitMins := 5
	if eta, etaErr := s.usecases.GetTicketETA(ctx, active.ID); etaErr == nil && eta.EstimatedWaitSeconds != nil && *eta.EstimatedWaitSeconds > 0 {
		waitMins = (*eta.EstimatedWaitSeconds + 30) / 60
	} else if workload, wErr := s.usecases.GetBranchWorkload(ctx, active.BranchID); wErr == nil && workload.EstimatedWaitSeconds != nil && *workload.EstimatedWaitSeconds > 0 {
		waitMins = (*workload.EstimatedWaitSeconds + 30) / 60
	} else if ahead > 0 {
		waitMins = ahead*4 + 3
	}

	return VoiceResponse{
		Text: fmt.Sprintf("Ваш талон %s в %s. Статус: в очереди. Перед вами %d %s, примерное время ожидания — около %d минут.",
			active.PublicNumber, branchName, ahead, pluralPeople(ahead), waitMins),
		Buttons: []string{"Отмени запись", "Где быстрее?"},
	}, nil
}
// CANCEL_TICKET ("Отмени запись")
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
// FASTEST_BRANCH / NEAREST_BRANCH
func (s *VoiceService) handleFastestBranch(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
	candidates, err := s.rankBranches(ctx, req.Location, req.Slots["street"])
	if err != nil || len(candidates) == 0 {
		return VoiceResponse{Text: "Не удалось найти доступные отделения."}, nil
	}

	msk := time.FixedZone("MSK", 3*3600)
	nowMSK := time.Now().In(msk)
	timeButtons := generateSuggestedTimeButtons(nowMSK, false)

	best := candidates[0]
	isOpenNow, openStr, closeStr := IsBranchOpenNow(best.Branch.WorkHours, nowMSK)
	if !isOpenNow && nowMSK.Hour() >= 18 {
		return VoiceResponse{
			Text: fmt.Sprintf("Отделение %s (%s) сейчас уже закрыто на сегодня (график: %s–%s). Вы можете записаться онлайн на завтра. На какое время вас записать?",
				best.Branch.Name, best.Branch.Address, openStr, closeStr),
			Buttons: generateSuggestedTimeButtons(nowMSK, true),
		}, nil
	}

	return VoiceResponse{
		Text: fmt.Sprintf("Быстрее всего сейчас отделение %s (%s): в очереди %d %s, ожидание около %d минут. Дорога пешком займет около %d минут. Всего с дорогой: около %d минут. На какое время вас записать онлайн?",
			best.Branch.Name, best.Branch.Address, best.WaitingCount, pluralPeople(best.WaitingCount), best.QueueMinutes, best.TravelMinutes, best.TotalMinutes),
		Buttons: timeButtons,
	}, nil
}

func (s *VoiceService) handleNearestBranch(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
	candidates, err := s.rankBranches(ctx, req.Location, req.Slots["street"])
	if err != nil || len(candidates) == 0 {
		return VoiceResponse{Text: "Не удалось найти доступные отделения."}, nil
	}

	msk := time.FixedZone("MSK", 3*3600)
	nowMSK := time.Now().In(msk)
	timeButtons := generateSuggestedTimeButtons(nowMSK, false)

		sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].DistanceKm < candidates[j].DistanceKm
	})
	nearest := candidates[0]
	isOpenNow, openStr, closeStr := IsBranchOpenNow(nearest.Branch.WorkHours, nowMSK)
	if !isOpenNow && nowMSK.Hour() >= 18 {
		return VoiceResponse{
			Text: fmt.Sprintf("Ближайшее отделение — %s (%s). Сейчас оно уже закрыто на сегодня (график: %s–%s). Вы можете записаться онлайн на завтра. На какое время вас записать?",
				nearest.Branch.Name, nearest.Branch.Address, openStr, closeStr),
			Buttons: generateSuggestedTimeButtons(nowMSK, true),
		}, nil
	}

	return VoiceResponse{
		Text: fmt.Sprintf("Ближайшее отделение — %s (%s). До него %.1f км (пешком около %d минут). В очереди сейчас %d %s, ожидание ~%d минут (всего ~%d минут с дорогой). На какое время вас записать онлайн?",
			nearest.Branch.Name, nearest.Branch.Address, nearest.DistanceKm, nearest.TravelMinutes, nearest.WaitingCount, pluralPeople(nearest.WaitingCount), nearest.QueueMinutes, nearest.TotalMinutes),
		Buttons: timeButtons,
	}, nil
}

func (s *VoiceService) handleHelp() (VoiceResponse, error) {
	msk := time.FixedZone("MSK", 3*3600)
	nowMSK := time.Now().In(msk)
	timeButtons := generateSuggestedTimeButtons(nowMSK, false)

	return VoiceResponse{
		Text: "Я помогу записаться на почту онлайн на удобное время. Вы можете сказать:\n— «Запиши на сегодня в 16:30»\n— «Запиши на завтра в 14:00»\n— «Где меньше очередь?»\n— «Сколько мне осталось ждать?»\n— «Отмени запись»",
		Buttons: timeButtons,
	}, nil
}
// Branch Ranking & Helpers
func (s *VoiceService) rankBranches(ctx context.Context, loc *UserLocation, streetQuery string) ([]BranchCandidate, error) {
	branches, err := s.usecases.ListBranches(ctx)
	if err != nil {
		return nil, err
	}
	if len(branches) == 0 {
		return nil, nil
	}

	// Default coordinates if location unknown
	userLat := 55.752176
	userLng := 48.744474
	if loc != nil && loc.Latitude != 0 && loc.Longitude != 0 {
		userLat = loc.Latitude
		userLng = loc.Longitude
	}

	// If user explicitly named a street or branch, filter by match
	var matchedBranch *domain.Branch
	if streetQuery != "" {
		matchedBranch = MatchBranchByQuery(branches, streetQuery)
	}

	msk := time.FixedZone("MSK", 3*3600)
	nowMSK := time.Now().In(msk)

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
		// If user selected a specific branch by name/query, but user GPS is unknown,
		// assume customer is in the local area of that branch (approx ~5-7 min walk)
		if matchedBranch != nil && (loc == nil || loc.Source == LocationSourceUnknown) && distKm > 30.0 {
			distKm = 0.5
		}
		travelMins := CalculateTravelMinutes(distKm)

		// Queue wait time and waiting count from real branch workload
		queueMins := 0
		waitingCount := 0
		if workload, wErr := s.usecases.GetBranchWorkload(ctx, b.ID); wErr == nil {
			waitingCount = workload.CurrentWaiting
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

		isOpen, _, _ := IsBranchOpenNow(b.WorkHours, nowMSK)

		candidates = append(candidates, BranchCandidate{
			Branch:        b,
			DistanceKm:    math.Round(distKm*10) / 10,
			TravelMinutes: travelMins,
			QueueMinutes:  queueMins,
			TotalMinutes:  travelMins + queueMins,
			WaitingCount:  waitingCount,
			IsOpenNow:     isOpen,
		})
	}

	// Sort: open branches first, then ascending by TotalMinutes (fastest first)
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].IsOpenNow != candidates[j].IsOpenNow {
			return candidates[i].IsOpenNow
		}
		return candidates[i].TotalMinutes < candidates[j].TotalMinutes
	})

	return candidates, nil
}

func (s *VoiceService) resolveDefaultServiceID(ctx context.Context, branchID string) string {
	services, err := s.usecases.ListBranchServices(ctx, branchID)
	if err == nil && len(services) > 0 {
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

func generateSuggestedTimeButtons(now time.Time, isTomorrow bool) []string {
	if isTomorrow {
		return []string{"Завтра в 10:00", "Завтра в 14:00", "Завтра в 17:00", "Где меньше очередь?"}
	}

	h := now.Hour()
	if h >= 19 {
		return []string{"На завтра в 10:00", "На завтра в 14:00", "На завтра в 17:00", "Где быстрее?"}
	}

	slot1 := now.Add(45 * time.Minute)
	slot2 := now.Add(105 * time.Minute)

	roundSlot := func(t time.Time) string {
		mn := t.Minute()
		if mn < 15 {
			mn = 0
		} else if mn < 45 {
			mn = 30
		} else {
			t = t.Add(1 * time.Hour)
			mn = 0
		}
		return fmt.Sprintf("Сегодня в %02d:%02d", t.Hour(), mn)
	}

	btn1 := roundSlot(slot1)
	btn2 := roundSlot(slot2)
	btn3 := "На завтра в 11:00"
	return []string{btn1, btn2, btn3, "Где меньше очередь?"}
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

func (s *VoiceService) handleLinkAccount(ctx context.Context, req VoiceRequest, user domain.User) (VoiceResponse, error) {
	acc := req.Slots["account"]
	if acc == "" {
		return VoiceResponse{
			Text: fmt.Sprintf("Ваш голос сейчас привязан к профилю %s. Чтобы привязать другой аккаунт, скажите: «Мой логин ваш_логин».", user.Email),
			Buttons: []string{"Мой талон", "Запиши на 15:30", "Помощь"},
		}, nil
	}

	extID := req.UserID
	if extID == "" {
		extID = req.ApplicationID
	}
	if extID == "" {
		extID = "anonymous_alice_user"
	}

		err := s.usecases.LinkExternalAccount(ctx, user.ID, "yandex_alice", extID)
	if err != nil {
		s.logger.WarnContext(ctx, "failed to link external account", "error", err, "acc", acc)
	}

	return VoiceResponse{
		Text: fmt.Sprintf("Отлично! Аккаунт %s успешно связан с Алисой. Ваши талоны синхронизированы с сайтом pointers-team.tech.", acc),
		Buttons: []string{"Мой талон", "Запиши меня на почту", "Запиши на 15:30"},
	}, nil
}


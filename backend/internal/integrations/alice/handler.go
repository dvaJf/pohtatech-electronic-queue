package alice

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"postcode/backend/internal/voice"
)

type Handler struct {
	service *voice.VoiceService
	logger  *slog.Logger
}

func NewHandler(service *voice.VoiceService, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{
		service: service,
		logger:  logger,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	// 1. Validate HTTP method
	if r.Method != http.MethodPost {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	// 2. Limit request body size to 1MB
	r.Body = http.MaxBytesReader(w, r.Body, 1024*1024)

	var req AliceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.WarnContext(r.Context(), "invalid alice webhook json", "error", err)
		voiceErrorsTotal.WithLabelValues("yandex_alice", "bad_request").Inc()
		writeFallbackResponse(w, "Произошла ошибка при обработке запроса. Пожалуйста, повторите фразу.")
		return
	}

	vReq := ToVoiceRequest(req)
	intentStr := string(vReq.Intent)
	voiceIntentsTotal.WithLabelValues("yandex_alice", intentStr).Inc()

	// 3. Process with timeout
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	vResp, err := h.service.HandleRequest(ctx, vReq)
	duration := time.Since(start)

	if err != nil {
		h.logger.ErrorContext(ctx, "voice service execution error",
			"error", err,
			"integration", "alice",
			"intent", intentStr,
			"session_id", req.Session.SessionID,
			"duration_ms", duration.Milliseconds(),
		)
		voiceErrorsTotal.WithLabelValues("yandex_alice", "internal_error").Inc()
		voiceRequestsTotal.WithLabelValues("yandex_alice", intentStr, "error").Inc()

		writeFallbackResponse(w, "Сейчас не получается связаться с сервисом очереди. Попробуйте чуть позже.")
		return
	}

	if vResp.RequiresConfirmation && vResp.PendingAction != nil {
		if vResp.PendingAction.Type == voice.ActionTakeTicket {
			voiceTicketCreatedTotal.WithLabelValues("yandex_alice", "live_pending").Inc()
		} else if vResp.PendingAction.Type == voice.ActionBookAppointment {
			voiceTicketCreatedTotal.WithLabelValues("yandex_alice", "appointment_pending").Inc()
		}
	}

	voiceRequestsTotal.WithLabelValues("yandex_alice", intentStr, "success").Inc()
	voiceRequestDurationSeconds.WithLabelValues("yandex_alice", intentStr).Observe(duration.Seconds())

	h.logger.InfoContext(ctx, "voice request processed",
		"integration", "alice",
		"intent", intentStr,
		"status", "success",
		"duration_ms", duration.Milliseconds(),
		"session_id", req.Session.SessionID,
	)

	aliceResp := ToAliceResponse(vResp, req.Version)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(aliceResp)
}

func writeFallbackResponse(w http.ResponseWriter, text string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(AliceResponse{
		Response: AliceRespBody{
			Text:       text,
			TTS:        text,
			EndSession: false,
			Buttons: []AliceButton{
				{Title: "Помощь", Hide: true},
				{Title: "Запиши меня на почту", Hide: true},
			},
		},
		Version: "1.0",
	})
}

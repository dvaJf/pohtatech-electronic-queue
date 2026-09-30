package alice

import (
	"encoding/json"
	"fmt"
	"time"

	"postcode/backend/internal/voice"
)

func ToVoiceRequest(req AliceRequest) voice.VoiceRequest {
	var pending *voice.PendingAction

	// Try extracting pending_action from Alice state.session
	if req.State != nil && req.State.Session != nil {
		if rawAction, ok := req.State.Session["pending_action"]; ok {
			if actBytes, err := json.Marshal(rawAction); err == nil {
				var pa voice.PendingAction
				if err := json.Unmarshal(actBytes, &pa); err == nil && pa.Type != "" {
					pending = &pa
				}
			}
		}
	}

	intent, scheduledAt, slots := ClassifyIntent(req.Request, pending != nil)

	userID := ""
	if req.Session.User != nil {
		userID = req.Session.User.UserID
	}

	reqID := fmt.Sprintf("%s:%d", req.Session.SessionID, req.Session.MessageID)

	var loc *voice.UserLocation
	// Default Moscow coordinates if no GPS available from dialog
	loc = &voice.UserLocation{
		Latitude:  55.7558,
		Longitude: 37.6173,
		Source:    voice.LocationSourceUnknown,
	}

	return voice.VoiceRequest{
		UserID:        userID,
		ApplicationID: req.Session.Application.ApplicationID,
		SessionID:     req.Session.SessionID,
		RequestID:     reqID,
		Command:       req.Request.Command,
		Intent:        intent,
		Location:      loc,
		Slots:         slots,
		ScheduledAt:   scheduledAt,
		PendingAction: pending,
	}
}

func ToAliceResponse(vResp voice.VoiceResponse, version string) AliceResponse {
	if version == "" {
		version = "1.0"
	}

	buttons := make([]AliceButton, 0, len(vResp.Buttons))
	for _, b := range vResp.Buttons {
		buttons = append(buttons, AliceButton{
			Title: b,
			Hide:  true,
		})
	}

	var sessionState map[string]any
	if vResp.PendingAction != nil && !time.Now().After(vResp.PendingAction.ExpiresAt) {
		sessionState = map[string]any{
			"pending_action": vResp.PendingAction,
		}
	}

	tts := vResp.TTS
	if tts == "" {
		tts = vResp.Text
	}

	return AliceResponse{
		Response: AliceRespBody{
			Text:       vResp.Text,
			TTS:        tts,
			EndSession: vResp.EndSession,
			Buttons:    buttons,
		},
		SessionState: sessionState,
		Version:      version,
	}
}

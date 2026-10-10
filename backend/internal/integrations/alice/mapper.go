package alice

import (
	"encoding/json"
	"fmt"
	"strings"
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

	// 1. If device provided real GPS in session.location:
	if req.Session.Location != nil && req.Session.Location.Lat != 0 && req.Session.Location.Lon != 0 {
		loc = &voice.UserLocation{
			Latitude:  req.Session.Location.Lat,
			Longitude: req.Session.Location.Lon,
			Accuracy:  req.Session.Location.Accuracy,
			Source:    voice.LocationSourceGPS,
		}
	} else {
		// 2. Default coordinates if no GPS available from dialog
		loc = &voice.UserLocation{
			Latitude:  55.752176,
			Longitude: 48.744474,
			Source:    voice.LocationSourceUnknown,
		}

		streetSlot := strings.ToLower(slots["street"])
		cmd := strings.ToLower(req.Request.Command)

		if strings.Contains(streetSlot, "иннополис") || strings.Contains(cmd, "иннополис") || strings.Contains(cmd, "университетск") {
			loc.Latitude = 55.752176
			loc.Longitude = 48.744474
			loc.Source = voice.LocationSourceVoice
		} else if strings.Contains(streetSlot, "казан") || strings.Contains(cmd, "казан") || strings.Contains(cmd, "бауман") || strings.Contains(cmd, "кремлев") || strings.Contains(cmd, "декабрист") || strings.Contains(cmd, "чистополь") || strings.Contains(cmd, "ямашев") {
			loc.Latitude = 55.795120
			loc.Longitude = 49.112340
			loc.Source = voice.LocationSourceVoice
		} else if strings.Contains(streetSlot, "рязан") || strings.Contains(cmd, "рязан") {
			loc.Latitude = 54.62912
			loc.Longitude = 39.73685
			loc.Source = voice.LocationSourceVoice
		} else if strings.Contains(streetSlot, "москв") || strings.Contains(cmd, "москв") || strings.Contains(cmd, "арбат") || strings.Contains(cmd, "тверск") || strings.Contains(cmd, "мясницк") {
			loc.Latitude = 55.7558
			loc.Longitude = 37.6173
			loc.Source = voice.LocationSourceVoice
		}
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

package voice

import "time"

type VoiceIntent string

const (
	IntentTakeTicket      VoiceIntent = "TAKE_TICKET"
	IntentBookAppointment VoiceIntent = "BOOK_APPOINTMENT"
	IntentCancelTicket    VoiceIntent = "CANCEL_TICKET"
	IntentTicketStatus    VoiceIntent = "TICKET_STATUS"
	IntentNearestBranch   VoiceIntent = "NEAREST_BRANCH"
	IntentFastestBranch   VoiceIntent = "FASTEST_BRANCH"
	IntentHelp            VoiceIntent = "HELP"
	IntentConfirm         VoiceIntent = "CONFIRM"
	IntentReject          VoiceIntent = "REJECT"
)

type LocationSource string

const (
	LocationSourceGPS     LocationSource = "gps"
	LocationSourceVoice   LocationSource = "voice"
	LocationSourceProfile LocationSource = "profile"
	LocationSourceUnknown LocationSource = "unknown"
)

type UserLocation struct {
	Latitude  float64        `json:"latitude"`
	Longitude float64        `json:"longitude"`
	Source    LocationSource `json:"source"`
}

type VoiceRequest struct {
	UserID        string            `json:"user_id"`
	ApplicationID string            `json:"application_id"`
	SessionID     string            `json:"session_id"`
	RequestID     string            `json:"request_id"`
	Command       string            `json:"command"`
	Intent        VoiceIntent       `json:"intent"`
	Location      *UserLocation     `json:"location,omitempty"`
	Slots         map[string]string `json:"slots,omitempty"`
	ScheduledAt   *time.Time        `json:"scheduled_at,omitempty"`
	PendingAction *PendingAction    `json:"pending_action,omitempty"`
}

type VoiceResponse struct {
	Text                 string         `json:"text"`
	TTS                  string         `json:"tts,omitempty"`
	RequiresConfirmation bool           `json:"requires_confirmation"`
	PendingAction        *PendingAction `json:"pending_action,omitempty"`
	EndSession           bool           `json:"end_session"`
	Buttons              []string       `json:"buttons,omitempty"`
}

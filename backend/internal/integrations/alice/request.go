package alice

import "encoding/json"

// AliceRequest represents an incoming webhook request from Yandex Alice (Dialogs).
type AliceRequest struct {
	Meta    AliceMeta    `json:"meta"`
	Session AliceSession `json:"session"`
	Request AliceReqBody `json:"request"`
	State   *AliceState  `json:"state,omitempty"`
	Version string       `json:"version"`
}

type AliceMeta struct {
	Locale     string          `json:"locale"`
	Timezone   string          `json:"timezone"`
	ClientID   string          `json:"client_id"`
	Interfaces AliceInterfaces `json:"interfaces"`
}

type AliceInterfaces struct {
	Screen      *struct{} `json:"screen,omitempty"`
	Geolocation *struct{} `json:"geolocation,omitempty"`
}

type AliceLocation struct {
	Lat      float64 `json:"lat"`
	Lon      float64 `json:"lon"`
	Accuracy float64 `json:"accuracy,omitempty"`
}

type AliceSession struct {
	MessageID   int              `json:"message_id"`
	SessionID   string           `json:"session_id"`
	SkillID     string           `json:"skill_id"`
	User        *AliceUser       `json:"user,omitempty"`
	Application AliceApplication `json:"application"`
	New         bool             `json:"new"`
	Location    *AliceLocation   `json:"location,omitempty"`
}

type AliceUser struct {
	UserID      string `json:"user_id"`
	AccessToken string `json:"access_token,omitempty"`
}

type AliceApplication struct {
	ApplicationID string `json:"application_id"`
}

type AliceReqBody struct {
	Command           string    `json:"command"`
	OriginalUtterance string    `json:"original_utterance"`
	Type              string    `json:"type"`
	NLU               AliceNLU  `json:"nlu"`
	Payload           any       `json:"payload,omitempty"`
}

type AliceNLU struct {
	Tokens   []string      `json:"tokens"`
	Entities []AliceEntity `json:"entities"`
	Intents  map[string]any `json:"intents,omitempty"`
}

type AliceEntity struct {
	Type  string          `json:"type"`
	Value json.RawMessage `json:"value"`
}

type AliceDateTimeEntity struct {
	Year           *int  `json:"year,omitempty"`
	Month          *int  `json:"month,omitempty"`
	Day            *int  `json:"day,omitempty"`
	DayIsRelative  *bool `json:"day_is_relative,omitempty"`
	Hour           *int  `json:"hour,omitempty"`
	Minute         *int  `json:"minute,omitempty"`
	HourIsRelative *bool `json:"hour_is_relative,omitempty"`
}

type AliceGeoEntity struct {
	City        string `json:"city,omitempty"`
	Street      string `json:"street,omitempty"`
	HouseNumber string `json:"house_number,omitempty"`
}

type AliceState struct {
	Session map[string]any `json:"session,omitempty"`
	User    map[string]any `json:"user,omitempty"`
}

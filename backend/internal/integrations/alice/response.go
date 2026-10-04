package alice

type AliceResponse struct {
	Response     AliceRespBody  `json:"response"`
	SessionState map[string]any `json:"session_state,omitempty"`
	Version      string         `json:"version"`
}

type AliceRespBody struct {
	Text       string           `json:"text"`
	TTS        string           `json:"tts,omitempty"`
	EndSession bool             `json:"end_session"`
	Buttons    []AliceButton    `json:"buttons,omitempty"`
	Directives *AliceDirectives `json:"directives,omitempty"`
}

type AliceDirectives struct {
	RequestGeolocation *struct{} `json:"request_geolocation,omitempty"`
}

type AliceButton struct {
	Title string `json:"title"`
	Hide  bool   `json:"hide,omitempty"`
	URL   string `json:"url,omitempty"`
}

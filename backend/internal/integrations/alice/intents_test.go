package alice

import (
	"encoding/json"
	"testing"
	"time"

	"postcode/backend/internal/voice"
)

func TestClassifyIntent_BasicPhrases(t *testing.T) {
	tests := []struct {
		name       string
		command    string
		hasPending bool
		wantIntent voice.VoiceIntent
	}{
		{"take ticket basic", "запиши меня на почту", false, voice.IntentTakeTicket},
		{"take ticket alias", "возьми талон", false, voice.IntentTakeTicket},
		{"take ticket queue", "встань за меня в очередь", false, voice.IntentTakeTicket},
		{"cancel ticket", "отмени запись", false, voice.IntentCancelTicket},
		{"cancel ticket alias", "отмени талон", false, voice.IntentCancelTicket},
		{"status remaining", "сколько мне осталось ждать", false, voice.IntentTicketStatus},
		{"status my ticket", "какой у меня номер", false, voice.IntentTicketStatus},
		{"fastest branch", "где быстрее", false, voice.IntentFastestBranch},
		{"fastest branch queue", "где меньше очередь", false, voice.IntentFastestBranch},
		{"nearest branch", "где ближайшая почта", false, voice.IntentNearestBranch},
		{"nearest branch alias", "какая почта ближе всего", false, voice.IntentNearestBranch},
		{"help", "что ты умеешь", false, voice.IntentHelp},
		{"confirm yes", "да", true, voice.IntentConfirm},
		{"confirm davay", "давай", true, voice.IntentConfirm},
		{"reject no", "нет", true, voice.IntentReject},
		{"reject cancel", "не надо", true, voice.IntentReject},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			intent, _, _ := ClassifyIntent(AliceReqBody{Command: tc.command}, tc.hasPending)
			if intent != tc.wantIntent {
				t.Errorf("ClassifyIntent(%q) = %v, want %v", tc.command, intent, tc.wantIntent)
			}
		})
	}
}

func TestClassifyIntent_BookAppointmentSpecificTime(t *testing.T) {
	tests := []struct {
		name       string
		command    string
		wantHour   int
		wantMinute int
		wantStreet string
	}{
		{
			name:       "time 15:30",
			command:    "запиши меня на 15:30",
			wantHour:   15,
			wantMinute: 30,
		},
		{
			name:       "time 14:00 with street",
			command:    "запиши на завтра в 14:00 на арбате",
			wantHour:   14,
			wantMinute: 0,
			wantStreet: "арбат",
		},
		{
			name:       "time 16 часов",
			command:    "запиши меня на 16 часов на тверской",
			wantHour:   16,
			wantMinute: 0,
			wantStreet: "тверская",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			intent, scheduled, slots := ClassifyIntent(AliceReqBody{Command: tc.command}, false)
			if intent != voice.IntentBookAppointment {
				t.Fatalf("expected IntentBookAppointment, got %v", intent)
			}
			if scheduled == nil {
				t.Fatalf("expected non-nil scheduled time for %q", tc.command)
			}
			msk := time.FixedZone("MSK", 3*3600)
			inMSK := scheduled.In(msk)
			if inMSK.Hour() != tc.wantHour || inMSK.Minute() != tc.wantMinute {
				t.Errorf("got time %02d:%02d, want %02d:%02d", inMSK.Hour(), inMSK.Minute(), tc.wantHour, tc.wantMinute)
			}
			if tc.wantStreet != "" && slots["street"] != tc.wantStreet {
				t.Errorf("got street slot %q, want %q", slots["street"], tc.wantStreet)
			}
		})
	}
}

func TestClassifyIntent_YandexDateTimeEntity(t *testing.T) {
	hour := 17
	minute := 45
	dayRel := true
	day := 1
	rawVal, _ := json.Marshal(AliceDateTimeEntity{
		Hour:          &hour,
		Minute:        &minute,
		DayIsRelative: &dayRel,
		Day:           &day,
	})

	req := AliceReqBody{
		Command: "запиши меня ко времени",
		NLU: AliceNLU{
			Entities: []AliceEntity{
				{Type: "YANDEX.DATETIME", Value: rawVal},
			},
		},
	}

	intent, scheduled, _ := ClassifyIntent(req, false)
	if intent != voice.IntentBookAppointment {
		t.Fatalf("expected IntentBookAppointment, got %v", intent)
	}
	if scheduled == nil {
		t.Fatalf("expected scheduled time")
	}
	msk := time.FixedZone("MSK", 3*3600)
	inMSK := scheduled.In(msk)
	if inMSK.Hour() != 17 || inMSK.Minute() != 45 {
		t.Errorf("got %02d:%02d, want 17:45", inMSK.Hour(), inMSK.Minute())
	}
}

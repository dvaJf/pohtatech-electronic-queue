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
		{"cancel ticket udali", "удали талон", false, voice.IntentCancelTicket},
		{"cancel ticket otkaz", "отказаться от талона", false, voice.IntentCancelTicket},
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

func TestClassifyIntent_NaturalConversationalPhrases(t *testing.T) {
	msk := time.FixedZone("MSK", 3*3600)

	// 1. Direct hour: "запиши на 15"
	intent1, sched1, _ := ClassifyIntent(AliceReqBody{Command: "запиши на 15"}, false)
	if intent1 != voice.IntentBookAppointment || sched1 == nil {
		t.Fatalf("expected IntentBookAppointment with time for 'запиши на 15', got %v, %v", intent1, sched1)
	}
	if sched1.In(msk).Hour() != 15 {
		t.Errorf("expected hour 15, got %d", sched1.In(msk).Hour())
	}

	// 2. Word numbers: "на завтра в два"
	intent2, sched2, slots2 := ClassifyIntent(AliceReqBody{Command: "на завтра в два"}, false)
	if intent2 != voice.IntentBookAppointment || sched2 == nil {
		t.Fatalf("expected IntentBookAppointment with time for 'на завтра в два', got %v, %v", intent2, sched2)
	}
	if sched2.In(msk).Hour() != 14 {
		t.Errorf("expected hour 14 for 'в два', got %d", sched2.In(msk).Hour())
	}
	if slots2["target_date"] != "tomorrow" {
		t.Errorf("expected target_date tomorrow, got %s", slots2["target_date"])
	}

	// 3. Time of day: "вечером"
	intent3, sched3, _ := ClassifyIntent(AliceReqBody{Command: "запиши вечером"}, false)
	if intent3 != voice.IntentBookAppointment || sched3 == nil {
		t.Fatalf("expected IntentBookAppointment with time for 'запиши вечером', got %v, %v", intent3, sched3)
	}
	if sched3.In(msk).Hour() != 18 {
		t.Errorf("expected hour 18 for 'вечером', got %d", sched3.In(msk).Hour())
	}

	// 4. Postal services: "отправить посылку"
	intent4, _, slots4 := ClassifyIntent(AliceReqBody{Command: "хочу отправить посылку"}, false)
	if intent4 != voice.IntentTakeTicket {
		t.Fatalf("expected IntentTakeTicket for 'хочу отправить посылку', got %v", intent4)
	}
	if slots4["service"] != "parcel" {
		t.Errorf("expected service parcel, got %s", slots4["service"])
	}

	// 5. Date only: "запиши на завтра"
	intent5, sched5, slots5 := ClassifyIntent(AliceReqBody{Command: "запиши на завтра"}, false)
	if intent5 != voice.IntentTakeTicket {
		t.Fatalf("expected IntentTakeTicket for date-only 'запиши на завтра', got %v", intent5)
	}
	if sched5 != nil {
		t.Errorf("expected nil scheduled time when no hour specified, got %v", sched5)
	}
	if slots5["target_date"] != "tomorrow" {
		t.Errorf("expected target_date tomorrow, got %s", slots5["target_date"])
	}

	// 6. Branch hotspots: Kazan & Moscow
	_, _, slotsKazan := ClassifyIntent(AliceReqBody{Command: "запиши на кремлевской"}, false)
	if slotsKazan["street"] != "кремлевская" {
		t.Errorf("expected street кремлевская, got %s", slotsKazan["street"])
	}

	_, _, slotsMsk := ClassifyIntent(AliceReqBody{Command: "запиши на лубянке"}, false)
	if slotsMsk["street"] != "лубянка" {
		t.Errorf("expected street лубянка, got %s", slotsMsk["street"])
	}
}

func TestToVoiceRequest_LocationResolution(t *testing.T) {
	// 1. User says "я в Иннополисе, где ближайшая почта"
	reqInno := AliceRequest{
		Request: AliceReqBody{
			Command: "я в иннополисе где ближайшая почта",
		},
		Session: AliceSession{
			SessionID: "sess-inno-1",
			MessageID: 1,
		},
	}
	vInno := ToVoiceRequest(reqInno)
	if vInno.Slots["street"] != "иннополис" {
		t.Errorf("expected slot street='иннополис', got: %s", vInno.Slots["street"])
	}
	if vInno.Location == nil || vInno.Location.Latitude != 55.752176 || vInno.Location.Longitude != 48.744474 {
		t.Errorf("expected Innopolis coords, got: %+v", vInno.Location)
	}

	// 2. User says "я в Казани"
	reqKazan := AliceRequest{
		Request: AliceReqBody{
			Command: "я в казани",
		},
		Session: AliceSession{
			SessionID: "sess-kazan-1",
			MessageID: 1,
		},
	}
	vKazan := ToVoiceRequest(reqKazan)
	if vKazan.Slots["street"] != "казань" {
		t.Errorf("expected slot street='казань', got: %s", vKazan.Slots["street"])
	}
	if vKazan.Location == nil || vKazan.Location.Latitude != 55.795120 || vKazan.Location.Longitude != 49.112340 {
		t.Errorf("expected Kazan coords, got: %+v", vKazan.Location)
	}

	// 3. User says "запиши на Университетской"
	reqUniv := AliceRequest{
		Request: AliceReqBody{
			Command: "запиши на университетской",
		},
		Session: AliceSession{
			SessionID: "sess-univ-1",
			MessageID: 1,
		},
	}
	vUniv := ToVoiceRequest(reqUniv)
	if vUniv.Slots["street"] != "университетская" {
		t.Errorf("expected slot street='университетская', got: %s", vUniv.Slots["street"])
	}
	if vUniv.Location == nil || vUniv.Location.Latitude != 55.752176 {
		t.Errorf("expected Innopolis coords for Университетская, got: %+v", vUniv.Location)
	}

	// 4. Device provides real GPS in Session.Location
	reqGPS := AliceRequest{
		Request: AliceReqBody{
			Command: "где ближайшая почта",
		},
		Session: AliceSession{
			SessionID: "sess-gps-1",
			MessageID: 1,
			Location: &AliceLocation{
				Lat:      55.751111,
				Lon:      48.742222,
				Accuracy: 10.0,
			},
		},
	}
	vGPS := ToVoiceRequest(reqGPS)
	if vGPS.Location == nil || vGPS.Location.Source != voice.LocationSourceGPS || vGPS.Location.Latitude != 55.751111 {
		t.Errorf("expected real device GPS, got: %+v", vGPS.Location)
	}
}



package alice

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"postcode/backend/internal/voice"
)

var (
	rxTimeColon  = regexp.MustCompile(`(?i)(?:на|в|к)?\s*(\d{1,2})[:.](\d{2})`)
	rxTimeHour   = regexp.MustCompile(`(?i)(?:на|в|к)\s*(\d{1,2})\s*(?:час(?:а|ов)?|ч\b)`)
	rxDirectHour = regexp.MustCompile(`(?i)(?:на|в|к)\s+(\d{1,2})\b`)
)

// ClassifyIntent parses user input and NLU data into a VoiceIntent, extracting slots and scheduled time.
func ClassifyIntent(req AliceReqBody, hasPendingAction bool) (voice.VoiceIntent, *time.Time, map[string]string) {
	cmd := strings.TrimSpace(strings.ToLower(req.Command))
	slots := make(map[string]string)

	// Extract street / branch location from NLU entities or text
	extractLocationSlots(req, cmd, slots)

	// Extract scheduled appointment time if present
	scheduledAt := extractScheduledTime(req, cmd, slots)

	// 1. If user is in confirmation phase and answers Yes/No
	if hasPendingAction {
		if isConfirmWord(cmd) {
			return voice.IntentConfirm, scheduledAt, slots
		}
		if isRejectWord(cmd) {
			return voice.IntentReject, scheduledAt, slots
		}
	} else {
		// Even without pending action, explicit "давай" / "да" might be confirmation
		if isConfirmWord(cmd) {
			return voice.IntentConfirm, scheduledAt, slots
		}
		if isRejectWord(cmd) {
			return voice.IntentReject, scheduledAt, slots
		}
	}

	// 2. Cancellation
	if containsAny(cmd, "отмени", "отменить", "отмена", "удали", "удалить", "удаление", "сними", "снять запись", "не пойду", "не хочу идти", "отказаться") {
		return voice.IntentCancelTicket, scheduledAt, slots
	}

	// 2.5 Link Account with website
	if containsAny(cmd, "мой логин", "моя почта", "привяжи", "свяжи", "синхронизируй") {
		tokens := strings.Fields(cmd)
		for i, tok := range tokens {
			if (tok == "логин" || tok == "почта" || tok == "аккаунт" || tok == "к") && i+1 < len(tokens) {
				slots["account"] = strings.Trim(tokens[i+1], ".,!?")
			}
		}
		return voice.IntentLinkAccount, scheduledAt, slots
	}

	// 3. Ticket Status
	if containsAny(cmd, "сколько мне осталось", "сколько ждать", "кто передо мной", "какой у меня номер", "мой талон", "где я в очереди", "статус талона") {
		return voice.IntentTicketStatus, scheduledAt, slots
	}

	// 4. Help
	if containsAny(cmd, "помощь", "что ты умеешь", "справка", "как пользоваться", "помоги", "help") {
		return voice.IntentHelp, scheduledAt, slots
	}

	// 5. Fastest branch
	if containsAny(cmd, "где быстрее", "где меньше очередь", "куда ехать быстрее", "минимальное ожидание", "быстрее всего") {
		return voice.IntentFastestBranch, scheduledAt, slots
	}

	// 6. Nearest branch
	if containsAny(cmd, "где ближайшая", "ближайшее отделение", "какая почта ближе всего", "где почта рядом", "ближайшая почта") {
		return voice.IntentNearestBranch, scheduledAt, slots
	}

	// 7. Specific appointment booking (Feature: user asks to book for a specific time)
	if scheduledAt != nil || containsAny(cmd, "ко времени", "на время", "запиши на час", "запиши на два", "запиши на три") {
		return voice.IntentBookAppointment, scheduledAt, slots
	}

	// 7.5 Postal service / tasks
	if containsAny(cmd, "посылк", "письм", "отправ", "получ", "бандерол", "марк", "перевод", "корреспонденц", "уведомлен") {
		slots["service"] = "parcel"
		return voice.IntentTakeTicket, scheduledAt, slots
	}

	// 8. General take ticket / live queue
	if containsAny(cmd, "запиши", "талон", "в очередь", "занять очередь", "возьми талон", "без ожидания", "почт") {
		return voice.IntentTakeTicket, scheduledAt, slots
	}

	// Default fallback to help if unknown
	if cmd == "" {
		return voice.IntentHelp, scheduledAt, slots
	}

	return voice.IntentTakeTicket, scheduledAt, slots
}

func isConfirmWord(cmd string) bool {
	words := []string{"да", "давай", "подтверждаю", "согласен", "согласна", "конечно", "беру", "записывай", "ок", "хорошо", "точно"}
	cmdTrim := strings.Trim(cmd, ".!? ")
	for _, w := range words {
		if cmdTrim == w {
			return true
		}
	}
	if strings.HasPrefix(cmdTrim, "да ") || strings.HasPrefix(cmdTrim, "ок ") || strings.HasPrefix(cmdTrim, "да,") {
		return true
	}
	return false
}

func isRejectWord(cmd string) bool {
	words := []string{"нет", "не надо", "отмена", "отбой", "не хочу", "передумал", "передумала", "стоп"}
	cmdTrim := strings.Trim(cmd, ".!? ")
	for _, w := range words {
		if cmdTrim == w {
			return true
		}
	}
	if strings.HasPrefix(cmdTrim, "нет ") || strings.HasPrefix(cmdTrim, "нет,") {
		return true
	}
	return false
}

func containsAny(s string, substrings ...string) bool {
	for _, sub := range substrings {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

func extractLocationSlots(req AliceReqBody, cmd string, slots map[string]string) {
	// 1. Check Yandex.GEO entities
	for _, ent := range req.NLU.Entities {
		if ent.Type == "YANDEX.GEO" {
			var geo AliceGeoEntity
			if err := json.Unmarshal(ent.Value, &geo); err == nil {
				if geo.Street != "" {
					slots["street"] = geo.Street
					return
				}
				if geo.City != "" {
					slots["street"] = geo.City
					return
				}
			}
		}
	}

	// 2. Fallback keyword extraction for known branches/streets (using stems to match all Russian grammatical cases)
	knownSpots := []struct {
		stem      string
		canonical string
	}{
		// Moscow
		{"москв", "москва"},
		{"арбат", "арбат"},
		{"тверск", "тверская"},
		{"рождественк", "рождественка"},
		{"покровк", "покровка"},
		{"никольск", "никольская"},
		{"землян", "земляной вал"},
		{"татарск", "большая татарская"},
		{"комсомольск", "комсомольская"},
		{"садов", "садовая-кудринская"},
		{"цветн", "цветной бульвар"},
		{"мира", "проспект мира"},
		{"авиамоторн", "авиамоторная"},
		{"бауманск", "бауманская"},
		{"валов", "валовая"},
		{"профсоюзн", "профсоюзная"},
		{"поварск", "поварская"},
		{"ленинск", "ленинский"},
		{"новослободск", "новослободская"},
		{"стромынк", "стромынка"},
		{"автозаводск", "автозаводская"},
		{"шмитовск", "шмитовский"},
		{"мясницк", "мясницкая"},
		{"рязан", "рязань"},
		{"ленинградск", "ленинградский"},
		{"кутузовск", "кутузовский"},
		{"варшавск", "варшавское"},
		{"каширск", "каширское"},
		{"лубянк", "лубянка"},
		{"таганск", "таганская"},
		{"павелецк", "павелецкая"},
		{"курск", "курская"},
		{"киевск", "киевская"},
		// Kazan & Tatarstan
		{"казан", "казань"},
		{"бауман", "баумана"},
		{"кремлевск", "кремлевская"},
		{"кремлёвск", "кремлевская"},
		{"декабрист", "декабристов"},
		{"ямашев", "ямашева"},
		{"вишневск", "вишневского"},
		{"чуйков", "чуйкова"},
		{"ершов", "ершова"},
		{"фучик", "фучика"},
		{"чистопольск", "чистопольская"},
		{"иннополис", "иннополис"},
		{"университетск", "университетская"},
		{"ибрагимов", "ибрагимова"},
		{"побед", "проспект победы"},
		{"татарстан", "татарстан"},
	}
	for _, spot := range knownSpots {
		if strings.Contains(cmd, spot.stem) {
			slots["street"] = spot.canonical
			return
		}
	}
}

func extractScheduledTime(req AliceReqBody, cmd string, slots map[string]string) *time.Time {
	msk := time.FixedZone("MSK", 3*3600)
	now := time.Now().In(msk)

	var hour, minute int
	hasTime := false

	// Target date offset: 0 for today, 1 for tomorrow, etc.
	targetDate := now

	// 1. Check YANDEX.DATETIME entity
	for _, ent := range req.NLU.Entities {
		if ent.Type == "YANDEX.DATETIME" {
			var dt AliceDateTimeEntity
			if err := json.Unmarshal(ent.Value, &dt); err == nil {
				if dt.DayIsRelative != nil && *dt.DayIsRelative && dt.Day != nil {
					targetDate = now.AddDate(0, 0, *dt.Day)
					if *dt.Day == 1 {
						slots["target_date"] = "tomorrow"
					}
				} else if dt.Day != nil {
					m := int(now.Month())
					if dt.Month != nil {
						m = *dt.Month
					}
					y := now.Year()
					if dt.Year != nil {
						y = *dt.Year
					}
					targetDate = time.Date(y, time.Month(m), *dt.Day, 0, 0, 0, 0, msk)
				}

				if dt.Hour != nil {
					hour = *dt.Hour
					if dt.Minute != nil {
						minute = *dt.Minute
					}
					hasTime = true
					break
				}
			}
		}
	}

	// 2. Date extraction: "послезавтра", "завтра", "сегодня"
	if strings.Contains(cmd, "послезавтра") {
		targetDate = now.AddDate(0, 0, 2)
		slots["target_date"] = "day_after"
	} else if strings.Contains(cmd, "завтра") {
		targetDate = now.AddDate(0, 0, 1)
		slots["target_date"] = "tomorrow"
	} else if strings.Contains(cmd, "сегодня") {
		targetDate = now
		slots["target_date"] = "today"
	}

	// 3. Regex fallback for time: "15:30", "14.00"
	if !hasTime {
		if m := rxTimeColon.FindStringSubmatch(cmd); len(m) == 3 {
			h, _ := strconv.Atoi(m[1])
			mn, _ := strconv.Atoi(m[2])
			if h >= 0 && h < 24 && mn >= 0 && mn < 60 {
				hour = h
				minute = mn
				hasTime = true
			}
		} else if m := rxTimeHour.FindStringSubmatch(cmd); len(m) == 2 {
			h, _ := strconv.Atoi(m[1])
			if h < 8 && strings.Contains(cmd, "дня") {
				h += 12
			} else if h < 7 && !strings.Contains(cmd, "утра") {
				h += 12 // assume PM if e.g. 2, 3, 4, 5, 6
			}
			if h >= 0 && h < 24 {
				hour = h
				minute = 0
				hasTime = true
			}
		} else if m := rxDirectHour.FindStringSubmatch(cmd); len(m) == 2 {
			// e.g. "на 15", "в 14", "к 11", "в 10"
			h, _ := strconv.Atoi(m[1])
			if h >= 1 && h <= 7 && !strings.Contains(cmd, "утра") {
				h += 12
			}
			if h >= 8 && h <= 21 {
				hour = h
				minute = 0
				hasTime = true
			}
		}
	}

	// 4. Word numbers for hours: "в два", "на три часа", "в десять утра", etc.
	if !hasTime {
		wordMatches := []struct {
			word string
			hour int
		}{
			{"одиннадцать", 11}, {"двенадцать", 12}, {"полдень", 12},
			{"десять", 10}, {"девять", 9}, {"восемь", 8},
			{"семь", 19}, {"шесть", 18}, {"пять", 17},
			{"четыре", 16}, {"три", 15}, {"два", 14}, {"час", 13},
		}
		for _, wm := range wordMatches {
			if strings.Contains(cmd, wm.word) {
				h := wm.hour
				if strings.Contains(cmd, "утра") && h > 12 {
					h -= 12
				}
				hour = h
				minute = 0
				hasTime = true
				break
			}
		}
	}

	// 5. Natural parts of day: "утром", "в обед", "вечером", "как можно скорее"
	if !hasTime {
		if strings.Contains(cmd, "утром") || strings.Contains(cmd, "с утра") {
			hour = 10
			minute = 0
			hasTime = true
		} else if strings.Contains(cmd, "в обед") || strings.Contains(cmd, "днем") || strings.Contains(cmd, "днём") {
			hour = 13
			minute = 0
			hasTime = true
		} else if strings.Contains(cmd, "вечером") || strings.Contains(cmd, "после работы") {
			hour = 18
			minute = 0
			hasTime = true
		} else if containsAny(cmd, "скорее", "побыстрее", "ближайшее", "как можно скорее", "сейчас") {
			soon := now.Add(35 * time.Minute)
			mn := soon.Minute()
			if mn < 15 {
				mn = 0
			} else if mn < 45 {
				mn = 30
			} else {
				soon = soon.Add(1 * time.Hour)
				mn = 0
			}
			if soon.Hour() >= 20 {
				targetDate = now.AddDate(0, 0, 1)
				hour = 10
				minute = 0
			} else {
				targetDate = now
				hour = soon.Hour()
				minute = mn
			}
			hasTime = true
		}
	}

	if !hasTime {
		return nil
	}

	scheduled := time.Date(targetDate.Year(), targetDate.Month(), targetDate.Day(), hour, minute, 0, 0, msk)

	// If scheduling for today but time has already passed, schedule for tomorrow at that time
	if scheduled.Before(now.Add(5 * time.Minute)) {
		scheduled = scheduled.AddDate(0, 0, 1)
	}

	slots["time"] = fmt.Sprintf("%02d:%02d", hour, minute)
	return &scheduled
}

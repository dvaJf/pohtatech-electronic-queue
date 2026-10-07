package voice

import (
	"fmt"
	"math"
	"strings"
	"time"

	"postcode/backend/internal/domain"
)

type BranchCandidate struct {
	Branch        domain.Branch
	DistanceKm    float64
	TravelMinutes int
	QueueMinutes  int
	TotalMinutes  int
	WaitingCount  int
	IsOpenNow     bool
}

// HaversineDistanceKm calculates great-circle distance between two GPS coordinates in kilometers.
func HaversineDistanceKm(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusKm = 6371.0
	dLat := (lat2 - lat1) * (math.Pi / 180.0)
	dLon := (lon2 - lon1) * (math.Pi / 180.0)
	lat1Rad := lat1 * (math.Pi / 180.0)
	lat2Rad := lat2 * (math.Pi / 180.0)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return earthRadiusKm * c
}

// CalculateTravelMinutes computes approximate walking transit time in minutes.
// Standard walking speed ~4.5 km/h -> ~13.33 min/km. Minimum 3 minutes.
func CalculateTravelMinutes(distanceKm float64) int {
	if distanceKm <= 0.1 {
		return 3
	}
	mins := int(math.Round(distanceKm / 4.5 * 60.0))
	if mins < 3 {
		mins = 3
	}
	return mins
}

// MatchBranchByQuery searches for a branch whose name or address contains the query words.
func MatchBranchByQuery(branches []domain.Branch, query string) *domain.Branch {
	query = strings.TrimSpace(strings.ToLower(query))
	if query == "" {
		return nil
	}

	// Remove common Russian prepositions
	stopwords := []string{"на", "в", "во", "у", "около", "отделение", "почта", "почту", "ул", "улица", "д", "дом"}
	words := strings.Fields(query)
	var meaningfulWords []string
	for _, w := range words {
		w = strings.Trim(w, ",.?!:;")
		isStop := false
		for _, s := range stopwords {
			if w == s {
				isStop = true
				break
			}
		}
		if !isStop && len(w) >= 3 {
			meaningfulWords = append(meaningfulWords, w)
		}
	}

	for _, b := range branches {
		nameLower := strings.ToLower(b.Name)
		addrLower := strings.ToLower(b.Address)

		for _, w := range meaningfulWords {
			if strings.Contains(nameLower, w) || strings.Contains(addrLower, w) {
				matched := b
				return &matched
			}
		}
	}
	return nil
}

// ParseWorkHours parses working hours strings like "09:00–18:00" or "08:00-20:00".
// Returns openMin, closeMin (minutes from midnight 00:00), formatted strings, and ok flag.
func ParseWorkHours(wh string) (openMin, closeMin int, openStr, closeStr string, ok bool) {
	wh = strings.TrimSpace(wh)
	if wh == "" {
		return 0, 0, "", "", false
	}
	// Replace various dash symbols (en-dash, em-dash) with regular hyphen
	wh = strings.ReplaceAll(wh, "–", "-")
	wh = strings.ReplaceAll(wh, "—", "-")
	parts := strings.Split(wh, "-")
	if len(parts) != 2 {
		return 0, 0, "", "", false
	}
	openStr = strings.TrimSpace(parts[0])
	closeStr = strings.TrimSpace(parts[1])

	var openH, openM, closeH, closeM int
	if n, err := fmt.Sscanf(openStr, "%d:%d", &openH, &openM); err != nil || n < 2 {
		return 0, 0, "", "", false
	}
	if n, err := fmt.Sscanf(closeStr, "%d:%d", &closeH, &closeM); err != nil || n < 2 {
		return 0, 0, "", "", false
	}
	return openH*60 + openM, closeH*60 + closeM, openStr, closeStr, true
}

// IsTimeWithinWorkHours checks if time t (evaluated in local MSK timezone) falls within branch work hours.
// If workHours is empty or unparseable, returns true, "", "" (assumes no restriction).
func IsTimeWithinWorkHours(wh string, t time.Time) (bool, string, string) {
	openMin, closeMin, openStr, closeStr, ok := ParseWorkHours(wh)
	if !ok {
		return true, "", ""
	}
	msk := time.FixedZone("MSK", 3*3600)
	tLocal := t.In(msk)
	minuteOfDay := tLocal.Hour()*60 + tLocal.Minute()

	if minuteOfDay >= openMin && minuteOfDay < closeMin {
		return true, openStr, closeStr
	}
	return false, openStr, closeStr
}

// IsBranchOpenNow checks if branch is open at time `now`.
func IsBranchOpenNow(wh string, now time.Time) (bool, string, string) {
	return IsTimeWithinWorkHours(wh, now)
}


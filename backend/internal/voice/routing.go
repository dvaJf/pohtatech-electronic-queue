package voice

import (
	"math"
	"strings"

	"postcode/backend/internal/domain"
)

type BranchCandidate struct {
	Branch        domain.Branch
	DistanceKm    float64
	TravelMinutes int
	QueueMinutes  int
	TotalMinutes  int
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

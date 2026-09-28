package httpapi

import (
	"net/http"
	"time"
)

type TicketETADTO struct {
	TicketID             string              `json:"ticketId"`
	TicketStatus         string              `json:"ticketStatus"`
	Reason               string              `json:"reason"`
	EstimatedWaitSeconds *int                `json:"estimatedWaitSeconds"`
	EstimatedCallAt      *time.Time          `json:"estimatedCallAt"`
	Position             *int                `json:"position"`
	ReferenceWindow      *WindowRefDTO       `json:"referenceWindow"`
	SampleSize           int                 `json:"sampleSize"`
	UsedFallback         bool                `json:"usedFallback"`
	WeightedWaitSeconds  *int                `json:"weightedWaitSeconds,omitempty"`
	MedianSeconds        *int                `json:"medianSeconds,omitempty"`
	P90WaitSeconds       *int                `json:"p90WaitSeconds,omitempty"`
	Distribution         *ETADistributionDTO `json:"distribution,omitempty"`
	CalculatedAt         time.Time           `json:"calculatedAt"`
	Source               string              `json:"source,omitempty"`
}

type ETADistributionDTO struct {
	Avg         int   `json:"avg"`
	WeightedAvg int   `json:"weightedAvg"`
	Median      int   `json:"median"`
	P90         int   `json:"p90"`
	Samples     []int `json:"samples,omitempty"`
}

func (a *API) GetTicketETA(w http.ResponseWriter, r *http.Request) {
	id, ok := ticketPath(w, r)
	if !ok {
		return
	}
	eta, err := a.usecases.GetTicketETA(r.Context(), id)
	if err != nil {
		a.respondError(w, r, err)
		return
	}
	var window *WindowRefDTO
	if eta.ReferenceWindow != nil {
		window = &WindowRefDTO{ID: eta.ReferenceWindow.ID, Number: eta.ReferenceWindow.Number}
	}
	var distribution *ETADistributionDTO
	if eta.Distribution != nil {
		distribution = &ETADistributionDTO{Avg: eta.Distribution.Avg, WeightedAvg: eta.Distribution.WeightedAvg, Median: eta.Distribution.Median, P90: eta.Distribution.P90, Samples: eta.Distribution.Samples}
	}
	writeJSONResponse(w, http.StatusOK, TicketETADTO{TicketID: eta.TicketID, TicketStatus: string(eta.TicketStatus), Reason: string(eta.Reason), EstimatedWaitSeconds: eta.EstimatedWaitSeconds, EstimatedCallAt: eta.EstimatedCallAt, Position: eta.Position, ReferenceWindow: window, SampleSize: eta.SampleSize, UsedFallback: eta.UsedFallback, WeightedWaitSeconds: eta.WeightedWaitSeconds, MedianSeconds: eta.MedianSeconds, P90WaitSeconds: eta.P90WaitSeconds, Distribution: distribution, CalculatedAt: eta.CalculatedAt, Source: eta.Source})
}

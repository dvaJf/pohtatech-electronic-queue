package application

import (
	"context"
	"postcode/backend/internal/domain"
)

type ETAPredictFeatures struct {
	TicketID          string  `json:"-"`
	ServiceID         string  `json:"service_id"`
	BranchID          string  `json:"branch_id"`
	Hour              int     `json:"hour"`
	Weekday           int     `json:"weekday"`
	Source            string  `json:"source"`
	ServedCount       int     `json:"served_count"`
	RollingAvgSeconds float64 `json:"rolling_avg_seconds"`
}

type ETAPredictor interface {
	Predict(ctx context.Context, items []ETAPredictFeatures, policy domain.MLEtaPolicy) ([]float64, string, error)
}

type ETAObservation interface {
	ObserveCompleted(ticketID string, durationSeconds float64)
}

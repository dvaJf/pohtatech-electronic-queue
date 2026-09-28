package domain

import "time"

type TicketETA struct {
	TicketID             string
	TicketStatus         TicketStatus
	Reason               QueuePositionReason
	EstimatedWaitSeconds *int
	EstimatedCallAt      *time.Time
	Position             *int
	ReferenceWindow      *WindowRef
	SampleSize           int
	UsedFallback         bool
	WeightedWaitSeconds  *int
	MedianSeconds        *int
	P90WaitSeconds       *int
	Distribution         *ETADistribution
	CalculatedAt         time.Time
	Source               string
}

type ETADistribution struct {
	Avg         int
	WeightedAvg int
	Median      int
	P90         int
	Samples     []int
}

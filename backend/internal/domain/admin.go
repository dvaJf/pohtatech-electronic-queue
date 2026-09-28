package domain

import "time"

type AdminMetrics struct {
	WaitingClientsCount int      `json:"waitingClientsCount"`
	AvgWaitTimeMinutes  int      `json:"avgWaitTimeMinutes"`
	MaxWaitTimeMinutes  int      `json:"maxWaitTimeMinutes"`
	ServedTodayCount    int      `json:"servedTodayCount"`
	ActiveWindowsCount  int      `json:"activeWindowsCount"`
	TotalWindowsCount   int      `json:"totalWindowsCount"`
	P90WaitMinutes      *float64 `json:"p90WaitMinutes,omitempty"`
}

type AdminWindow struct {
	ID                  string       `json:"id"`
	Number              int          `json:"number"`
	Status              WindowStatus `json:"status"`
	CurrentTicketNumber *string      `json:"currentTicketNumber"`
	CurrentService      *string      `json:"currentService"`
	Services            []Service    `json:"services"`
	ServedCount         int          `json:"servedCount"`
	OperatorName        *string      `json:"operatorName,omitempty"`
}

type AdminQueueTicket struct {
	ID              string       `json:"id"`
	PublicNumber    string       `json:"publicNumber"`
	Source          TicketSource `json:"source"`
	ServiceID       string       `json:"serviceId"`
	ServiceName     string       `json:"serviceName"`
	QueueEnteredAt  time.Time    `json:"queueEnteredAt"`
	WaitTimeMinutes int          `json:"waitTimeMinutes"`
	Status          TicketStatus `json:"status"`
}

type OperatorQueue struct {
	Items []AdminQueueTicket `json:"items"`
	Total int                `json:"total"`
}

type PriorityRule struct {
	Source              TicketSource `json:"source"`
	Name                string       `json:"name"`
	Weight              int          `json:"weight"`
	MaxWaitLimitMinutes int          `json:"maxWaitLimitMinutes"`
	Description         string       `json:"description"`
}

type AnomalyType string

const (
	AnomalyExceededWait AnomalyType = "EXCEEDED_WAIT"
	AnomalyUnfinished   AnomalyType = "UNFINISHED"
	AnomalyNoShow       AnomalyType = "NO_SHOW"
	AnomalyTechIssue    AnomalyType = "TECH_ISSUE"
)

type AnomalyTicket struct {
	ID              string      `json:"id"`
	PublicNumber    string      `json:"publicNumber"`
	Type            AnomalyType `json:"type"`
	Description     string      `json:"description"`
	Time            time.Time   `json:"time"`
	DurationMinutes int         `json:"durationMinutes"`
}

type AnomalyPage struct {
	Items []AnomalyTicket `json:"items"`
	Total int             `json:"total"`
}

type AdminBranchOverview struct {
	BranchID             string                `json:"branchId"`
	BranchName           string                `json:"branchName"`
	Metrics              AdminMetrics          `json:"metrics"`
	Windows              []AdminWindow         `json:"windows"`
	Queue                []AdminQueueTicket    `json:"queue"`
	Priorities           []PriorityRule        `json:"priorities"`
	Anomalies            []AnomalyTicket       `json:"anomalies"`
	Quality              BranchQuality         `json:"quality"`
	WindowRecommendation *WindowRecommendation `json:"windowRecommendation,omitempty"`
}

type WindowRecommendation struct {
	RecommendedCount int     `json:"recommendedCount"`
	Reason           string  `json:"reason"`
	Severity         string  `json:"severity"`
	P90WaitMinutes   float64 `json:"p90WaitMinutes"`
}

type OperatorIncident struct {
	ID          string    `json:"id"`
	BranchID    string    `json:"branchId"`
	WindowID    *string   `json:"windowId,omitempty"`
	OperatorID  *string   `json:"operatorId,omitempty"`
	Category    string    `json:"category"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
}

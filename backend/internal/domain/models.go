package domain

import "time"

type TicketSource string

const (
	TicketSourceAppointment TicketSource = "APPOINTMENT"
	TicketSourceQR          TicketSource = "QR"
	TicketSourceLive        TicketSource = "LIVE"
)

type TicketStatus string

const (
	TicketStatusPendingConfirmation TicketStatus = "PENDING_CONFIRMATION"
	TicketStatusScheduled           TicketStatus = "SCHEDULED"
	TicketStatusWaiting             TicketStatus = "WAITING"
	TicketStatusCalled              TicketStatus = "CALLED"
	TicketStatusServing             TicketStatus = "SERVING"
	TicketStatusCompleted           TicketStatus = "COMPLETED"
	TicketStatusCancelled           TicketStatus = "CANCELLED"
	TicketStatusNoShow              TicketStatus = "NO_SHOW"
)

type WindowStatus string

const (
	WindowStatusClosed  WindowStatus = "CLOSED"
	WindowStatusOpen    WindowStatus = "OPEN"
	WindowStatusClosing WindowStatus = "CLOSING"
)

type Branch struct {
	Latitude       *float64 `json:"latitude,omitempty"`
	Longitude      *float64 `json:"longitude,omitempty"`
	IsDemo         bool     `json:"isDemo"`
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Address        string   `json:"address"`
	WorkHours      string   `json:"workHours"`
	TimezoneOffset int      `json:"timezoneOffset"`
	RatingAverage  *float64 `json:"ratingAverage"`
	RatingCount    int      `json:"ratingCount"`
}

type BranchQuality struct {
	RatingAverage     *float64         `json:"ratingAverage"`
	RatingCount       int              `json:"ratingCount"`
	Current30Average  *float64         `json:"current30Average"`
	Current30Count    int              `json:"current30Count"`
	Previous30Average *float64         `json:"previous30Average"`
	Previous30Count   int              `json:"previous30Count"`
	Delta             *float64         `json:"delta"`
	Distribution      map[string]int   `json:"distribution"`
	LowRatingCount    int              `json:"lowRatingCount"`
	RecentFeedback    []RecentFeedback `json:"recentFeedback"`
}
type RecentFeedback struct {
	Rating    int       `json:"rating"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"createdAt"`
}

type CreatedReview struct {
	ID        string    `json:"id"`
	BranchID  string    `json:"branchId"`
	Rating    int       `json:"rating"`
	Comment   string    `json:"comment"`
	CreatedAt time.Time `json:"createdAt"`
}

type AdminReviewItem struct {
	ID         string    `json:"id"`
	BranchID   string    `json:"branchId"`
	BranchName string    `json:"branchName"`
	Rating     int       `json:"rating"`
	Comment    string    `json:"comment"`
	CreatedAt  time.Time `json:"createdAt"`
}

type AdminReviewsFilter struct {
	BranchID string
	Rating   int
	Sort     string
	Page     int
	PageSize int
}

type AdminReviewSummary struct {
	AverageRating *float64       `json:"averageRating"`
	TotalReviews  int            `json:"totalReviews"`
	Distribution  map[string]int `json:"distribution"`
}

type AdminReviewsResult struct {
	Items      []AdminReviewItem  `json:"items"`
	Page       int                `json:"page"`
	PageSize   int                `json:"pageSize"`
	Total      int                `json:"total"`
	TotalPages int                `json:"totalPages"`
	Summary    AdminReviewSummary `json:"summary"`
}

type Service struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
}
type Window struct {
	ID       string
	BranchID string
	Number   int
	Status   WindowStatus
	Services []Service
}
type WindowRef struct {
	ID     string
	Number int
}
type Ticket struct {
	ID               string
	PublicNumber     string
	BranchID         string
	ServiceID        string
	ServiceName      string
	Source           TicketSource
	Status           TicketStatus
	Window           *WindowRef
	CreatedAt        time.Time
	QueueEnteredAt   time.Time
	ScheduledAt      *time.Time
	ArrivedAt        *time.Time
	CalledAt         *time.Time
	ServiceStartedAt *time.Time
	CompletedAt      *time.Time
	NoShowAt         *time.Time
	CheckinAt        *time.Time
	ReadyAt          *time.Time
	DueAt            *time.Time
	SourceRank       int
	PolicyVersion    int64
	RecallCount      int
	ClientID              *string
	ManagementToken       *string
	ConfirmationTokenHash *string
	ConfirmationCode      *string
	ConfirmationExpiresAt *time.Time
	ConfirmedAt           *time.Time
	NotificationEmail     *string
	NotificationPhone     *string
}

type QueuePolicy struct {
	BranchID                        string
	AppointmentDuePriority          int
	QRPriority                      int
	LivePriority                    int
	AntiStarvationThresholdMinutes  int
	AntiStarvationPointsPerMinute   int
	AppointmentGraceMinutes         int
	AppointmentLatePenaltyPerMinute int
	AppointmentLatePenaltyMaxPoints int
	Version                         int64
	UpdatedAt                       time.Time
}
type TicketEventType string

const (
	TicketEventCreated           TicketEventType = "CREATED"
	TicketEventArrived           TicketEventType = "ARRIVED"
	TicketEventNoShow            TicketEventType = "NO_SHOW"
	TicketEventCalled            TicketEventType = "CALLED"
	TicketEventServiceStarted    TicketEventType = "SERVICE_STARTED"
	TicketEventCompleted         TicketEventType = "COMPLETED"
	TicketEventCancelled         TicketEventType = "CANCELLED"
	TicketEventReturned          TicketEventType = "RETURNED"
	TicketEventRedirected        TicketEventType = "REDIRECTED"
	TicketEventQueueRecalculated TicketEventType = "QUEUE_RECALCULATED"
)

type TicketEvent struct {
	ID               int64
	TicketID         string
	Type             TicketEventType
	FromStatus       *TicketStatus
	ToStatus         TicketStatus
	WindowID         *string
	PolicyVersion    *int64
	DecisionPriority *int64
	OccurredAt       time.Time
	Actor            *string
	Reason           *string
	DueAt            *time.Time
	RequestID        *string
	At               *time.Time
}

type QueuePositionReason string

const (
	QueuePositionAvailable              QueuePositionReason = "AVAILABLE"
	QueuePositionNotEligibleYet         QueuePositionReason = "NOT_ELIGIBLE_YET"
	QueuePositionNoOpenCompatibleWindow QueuePositionReason = "NO_OPEN_COMPATIBLE_WINDOW"
	QueuePositionNotQueued              QueuePositionReason = "NOT_QUEUED"
)

type QueuePosition struct {
	TicketID           string
	TicketStatus       TicketStatus
	Reason             QueuePositionReason
	Position           *int
	ReferenceWindow    *WindowRef
	CalculatedAt       time.Time
	EffectivePriority  *int64
	EffectiveQueueTime *time.Time
}

type HourlyWorkload struct {
	Hour        int  `json:"hour"`
	LoadPercent int  `json:"loadPercent"`
	WaitMinutes int  `json:"waitMinutes"`
	IsPeak      bool `json:"isPeak"`
}

type BranchWorkload struct {
	ActiveWindows        int              `json:"activeWindows"`
	EstimatedWaitSeconds *int             `json:"estimatedWaitSeconds"`
	CalculatedAt         time.Time        `json:"calculatedAt"`
	UsedFallback         bool             `json:"usedFallback"`
	BranchID             string           `json:"branchId"`
	CurrentHour          int              `json:"currentHour"`
	CurrentWaiting       int              `json:"currentWaiting"`
	SampleCount          int              `json:"sampleCount"`
	IsHistorical         bool             `json:"isHistorical"`
	Hourly               []HourlyWorkload `json:"hourly"`
}

type ShiftClosureResult struct {
	BranchID              string `json:"branchId"`
	CancelledTicketsCount int    `json:"cancelledTicketsCount"`
	WindowsClosingCount   int    `json:"windowsClosingCount"`
	WindowsClosedCount    int    `json:"windowsClosedCount"`
}

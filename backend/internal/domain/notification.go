package domain

import "time"

type NotificationEventType string

const (
	NotificationTicketCalled   NotificationEventType = "TICKET_CALLED"
	NotificationTicketNearTurn NotificationEventType = "TICKET_NEAR_TURN"
)

type NotificationStatus string

const (
	NotificationStatusPending NotificationStatus = "PENDING"
	NotificationStatusSent    NotificationStatus = "SENT"
	NotificationStatusFailed  NotificationStatus = "FAILED"
)

// NotificationMessage is the transport-agnostic message passed to NotificationSender.
type NotificationMessage struct {
	ID           string                `json:"id"`
	TicketID     string                `json:"ticketId"`
	BranchID     string                `json:"branchId"`
	PublicNumber string                `json:"publicNumber"`
	WindowNumber int                   `json:"windowNumber"`
	EventType    NotificationEventType `json:"eventType"`
	CreatedAt    time.Time             `json:"createdAt"`
}

// NotificationOutboxItem represents a record in notification_outbox table.
type NotificationOutboxItem struct {
	ID            string                `json:"id"`
	TicketID      string                `json:"ticketId"`
	BranchID      string                `json:"branchId"`
	EventType     NotificationEventType `json:"eventType"`
	Payload       string                `json:"payload"`
	Status        NotificationStatus    `json:"status"`
	Attempts      int                   `json:"attempts"`
	MaxAttempts   int                   `json:"maxAttempts"`
	NextAttemptAt time.Time             `json:"nextAttemptAt"`
	CreatedAt     time.Time             `json:"createdAt"`
	SentAt        *time.Time            `json:"sentAt,omitempty"`
	LastError     *string               `json:"lastError,omitempty"`
}

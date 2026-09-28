package domain

import "time"

type NotificationEventType string

const (
	NotificationTicketCalled            NotificationEventType = "TICKET_CALLED"
	NotificationTicketNearTurn          NotificationEventType = "TICKET_NEAR_TURN"
	NotificationAppointmentReminder     NotificationEventType = "APPOINTMENT_REMINDER_30M"
	NotificationAppointmentConfirmation NotificationEventType = "APPOINTMENT_CONFIRMATION"
)

type NotificationChannel string

const (
	NotificationChannelDemo     NotificationChannel = "DEMO"
	NotificationChannelTelegram NotificationChannel = "TELEGRAM"
	NotificationChannelWebPush  NotificationChannel = "WEB_PUSH"
	NotificationChannelSMS      NotificationChannel = "SMS"
	NotificationChannelEmail    NotificationChannel = "EMAIL"
)

type NotificationSubscription struct {
	ID          string              `json:"id"`
	TicketID    string              `json:"ticketId"`
	Channel     NotificationChannel `json:"channel"`
	Destination string              `json:"destination,omitempty"`
	Enabled     bool                `json:"enabled"`
}

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
	Channel      NotificationChannel   `json:"channel,omitempty"`
	Destination  string                `json:"destination,omitempty"`
	Body         string                `json:"body,omitempty"`
	URL          string                `json:"url,omitempty"`
	CreatedAt    time.Time             `json:"createdAt"`
}

// NotificationOutboxItem represents a record in notification_outbox table.
type NotificationOutboxItem struct {
	ID             string                `json:"id"`
	TicketID       string                `json:"ticketId"`
	BranchID       string                `json:"branchId"`
	EventType      NotificationEventType `json:"eventType"`
	Payload        string                `json:"payload"`
	Status         NotificationStatus    `json:"status"`
	Attempts       int                   `json:"attempts"`
	MaxAttempts    int                   `json:"maxAttempts"`
	NextAttemptAt  time.Time             `json:"nextAttemptAt"`
	CreatedAt      time.Time             `json:"createdAt"`
	SentAt         *time.Time            `json:"sentAt,omitempty"`
	LastError      *string               `json:"lastError,omitempty"`
	Channel        NotificationChannel   `json:"channel,omitempty"`
	SubscriptionID *string               `json:"subscriptionId,omitempty"`
	Destination    string                `json:"-"`
	AvailableAt    time.Time             `json:"availableAt"`
}

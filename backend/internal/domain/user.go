package domain

import "time"

// UserRole определяет уровень доступа пользователя в системе.
type UserRole string

const (
	RoleClient   UserRole = "client"
	RoleEmployee UserRole = "employee"
	RoleOPCChief UserRole = "opc_chief" // Начальник ОПС
	RoleTerminal UserRole = "terminal"
)

// User — аккаунт в системе электронной очереди.
type User struct {
	ID           string
	Email        string
	PasswordHash string
	Role         UserRole
	IsTerminal   bool
	Confirmed    bool
	ConfirmToken *string
	ConfirmCode  *string
	ConfirmCodeExpiresAt *time.Time
	Phone        *string
	PhoneVerified bool
	CreatedAt    time.Time
}

type UserPage struct {
	Items  []User     `json:"items"`
	Total  int        `json:"total"`
	Counts UserCounts `json:"counts"`
}

// UserCounts includes all search matches, before role filtering and pagination.
type UserCounts struct {
	All      int `json:"all"`
	Employee int `json:"employee"`
	OPCChief int `json:"opc_chief"`
	Client   int `json:"client"`
	Terminal int `json:"terminal"`
}

// Session — аутентификационная сессия (cookie-based).
type Session struct {
	Token     string
	UserID    string
	ExpiresAt time.Time
	CreatedAt time.Time
}

// AppointmentSMSNotification represents an upcoming appointment needing an SMS reminder.
type AppointmentSMSNotification struct {
	TicketID     string    `json:"ticketId"`
	PublicNumber string    `json:"publicNumber"`
	BranchName   string    `json:"branchName"`
	ScheduledAt  time.Time `json:"scheduledAt"`
	Phone        string    `json:"phone"`
}

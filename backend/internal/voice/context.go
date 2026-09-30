package voice

import (
	"sync"
	"time"
)

type PendingActionType string

const (
	ActionTakeTicket      PendingActionType = "TAKE_TICKET"
	ActionBookAppointment PendingActionType = "BOOK_APPOINTMENT"
	ActionCancelTicket    PendingActionType = "CANCEL_TICKET"
)

type PendingAction struct {
	Type         PendingActionType `json:"type"`
	BranchID     string            `json:"branch_id"`
	BranchName   string            `json:"branch_name"`
	ServiceID    string            `json:"service_id"`
	ScheduledAt  *time.Time        `json:"scheduled_at,omitempty"`
	TicketID     string            `json:"ticket_id,omitempty"`
	PublicNumber string            `json:"public_number,omitempty"`
	ExpiresAt    time.Time         `json:"expires_at"`
}

type SessionStore interface {
	GetPendingAction(sessionID string) (*PendingAction, bool)
	SetPendingAction(sessionID string, action *PendingAction, ttl time.Duration)
	ClearPendingAction(sessionID string)
	CheckAndSetIdempotency(requestID string, ttl time.Duration) bool
}

type memoryEntry struct {
	action    *PendingAction
	expiresAt time.Time
}

type MemorySessionStore struct {
	mu          sync.RWMutex
	sessions    map[string]memoryEntry
	idempotency map[string]time.Time
}

func NewMemorySessionStore() *MemorySessionStore {
	store := &MemorySessionStore{
		sessions:    make(map[string]memoryEntry),
		idempotency: make(map[string]time.Time),
	}
	// Background cleanup of expired entries
	go func() {
		ticker := time.NewTicker(2 * time.Minute)
		for range ticker.C {
			store.cleanup()
		}
	}()
	return store
}

func (s *MemorySessionStore) cleanup() {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	for k, v := range s.sessions {
		if now.After(v.expiresAt) {
			delete(s.sessions, k)
		}
	}
	for k, exp := range s.idempotency {
		if now.After(exp) {
			delete(s.idempotency, k)
		}
	}
}

func (s *MemorySessionStore) GetPendingAction(sessionID string) (*PendingAction, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	entry, ok := s.sessions[sessionID]
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.action, true
}

func (s *MemorySessionStore) SetPendingAction(sessionID string, action *PendingAction, ttl time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sessionID] = memoryEntry{
		action:    action,
		expiresAt: time.Now().Add(ttl),
	}
}

func (s *MemorySessionStore) ClearPendingAction(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, sessionID)
}

func (s *MemorySessionStore) CheckAndSetIdempotency(requestID string, ttl time.Duration) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	if exp, exists := s.idempotency[requestID]; exists && now.Before(exp) {
		return false // already processed
	}
	s.idempotency[requestID] = now.Add(ttl)
	return true // first time
}

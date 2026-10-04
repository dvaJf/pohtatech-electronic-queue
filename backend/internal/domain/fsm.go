package domain

import (
	"errors"
	"fmt"
)

// ErrInvalidTransition indicates a status transition violates the ticket FSM.
var ErrInvalidTransition = errors.New("invalid state transition")

// AllowedTransitions defines valid ticket status transitions in the FSM.
var AllowedTransitions = map[TicketStatus]map[TicketStatus]bool{
	TicketStatusPendingConfirmation: {
		TicketStatusScheduled: true, // confirmed via email/code
		TicketStatusCancelled: true, // expired or cancelled
	},
	TicketStatusScheduled: {
		TicketStatusScheduled: true, // check-in/arrived before slot
		TicketStatusWaiting:   true, // checked in and waiting for call
		TicketStatusCalled:    true, // direct call
		TicketStatusCancelled: true, // cancelled by client
	},
	TicketStatusWaiting: {
		TicketStatusCalled:    true, // called by operator window
		TicketStatusCancelled: true, // cancelled by client
	},
	TicketStatusCalled: {
		TicketStatusCalled:  true, // repeat call / recall
		TicketStatusServing: true, // service started
		TicketStatusWaiting: true, // returned to queue / timeout recall
		TicketStatusNoShow:  true, // client did not appear
	},
	TicketStatusServing: {
		TicketStatusCompleted: true, // service completed
		TicketStatusWaiting:   true, // returned to queue / redirected to another service
	},
	// Terminal states have no outbound transitions
	TicketStatusCompleted: {},
	TicketStatusCancelled: {},
	TicketStatusNoShow:    {},
}

// ValidateTransition checks if moving from fromStatus to toStatus is permitted by the FSM.
func ValidateTransition(from, to TicketStatus) error {
	if from == "" {
		// Ticket creation (initial state)
		if to == TicketStatusScheduled || to == TicketStatusWaiting || to == TicketStatusPendingConfirmation {
			return nil
		}
		return fmt.Errorf("initial state cannot be %s: %w", to, ErrInvalidTransition)
	}

	targets, exists := AllowedTransitions[from]
	if !exists || !targets[to] {
		return fmt.Errorf("transition from %s to %s is forbidden by FSM: %w", from, to, ErrInvalidTransition)
	}
	return nil
}

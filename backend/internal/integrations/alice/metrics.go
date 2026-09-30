package alice

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	voiceRequestsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "voice_requests_total",
			Help: "Total number of voice requests processed by integration.",
		},
		[]string{"provider", "intent", "status"},
	)

	voiceRequestDurationSeconds = promauto.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "voice_request_duration_seconds",
			Help:    "Latency of voice request processing in seconds.",
			Buckets: []float64{0.05, 0.1, 0.25, 0.5, 1, 2, 5},
		},
		[]string{"provider", "intent"},
	)

	voiceErrorsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "voice_errors_total",
			Help: "Total count of voice integration errors.",
		},
		[]string{"provider", "status"},
	)

	voiceIntentsTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "voice_intents_total",
			Help: "Distribution of voice intents detected.",
		},
		[]string{"provider", "intent"},
	)

	voiceTicketCreatedTotal = promauto.NewCounterVec(
		prometheus.CounterOpts{
			Name: "voice_ticket_created_total",
			Help: "Total tickets created via voice assistant.",
		},
		[]string{"provider", "ticket_type"},
	)
)

package observability

import "github.com/prometheus/client_golang/prometheus/promauto"
import "github.com/prometheus/client_golang/prometheus"

var (
	MLRequests        = promauto.NewCounterVec(prometheus.CounterOpts{Name: "ml_requests_total", Help: "ML prediction requests"}, []string{"status"})
	MLFallbacks       = promauto.NewCounterVec(prometheus.CounterOpts{Name: "ml_fallback_total", Help: "ML prediction fallbacks"}, []string{"reason"})
	MLLatency         = promauto.NewHistogram(prometheus.HistogramOpts{Name: "ml_latency_seconds", Help: "ML request latency"})
	MLPredictionError = promauto.NewHistogram(prometheus.HistogramOpts{Name: "ml_prediction_error", Help: "Absolute ML prediction error in seconds"})
)

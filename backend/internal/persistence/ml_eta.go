package persistence

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
	"postcode/backend/internal/observability"
	"sync"
	"time"
)

type mlRequest struct {
	Items []application.ETAPredictFeatures `json:"items"`
}
type mlResponse struct {
	Predictions  []float64 `json:"predictions"`
	ModelVersion string    `json:"model_version"`
}

type mlCacheItem struct {
	values  []float64
	version string
	expires time.Time
}
type MLEtaAdapter struct {
	client    *http.Client
	logger    *slog.Logger
	mu        sync.Mutex
	failures  int
	openUntil time.Time
	cache     map[string]mlCacheItem
	predicted map[string]float64
}

func NewMLEtaAdapter(logger *slog.Logger) *MLEtaAdapter {
	return &MLEtaAdapter{client: &http.Client{}, logger: logger, cache: make(map[string]mlCacheItem), predicted: make(map[string]float64)}
}

func featureKey(items []application.ETAPredictFeatures) string {
	b, _ := json.Marshal(items)
	return string(b)
}

func (a *MLEtaAdapter) Predict(ctx context.Context, items []application.ETAPredictFeatures, policy domain.MLEtaPolicy) ([]float64, string, error) {
	if !policy.Enabled {
		return nil, "", errors.New("ml disabled")
	}
	if len(items) == 0 {
		return nil, "", errors.New("empty prediction batch")
	}
	url := policy.URL
	if url == "" {
		return nil, "", errors.New("ml url not configured")
	}
	key := featureKey(items)
	now := time.Now()
	a.mu.Lock()
	if cached, ok := a.cache[key]; ok && now.Before(cached.expires) {
		vals := append([]float64(nil), cached.values...)
		ver := cached.version
		for i, item := range items {
			if item.TicketID != "" {
				a.predicted[item.TicketID] = vals[i]
			}
		}
		a.mu.Unlock()
		return vals, ver, nil
	}
	if now.Before(a.openUntil) {
		a.mu.Unlock()
		observability.MLFallbacks.WithLabelValues("circuit_open").Inc()
		return nil, "", errors.New("ml circuit open")
	}
	a.mu.Unlock()
	body, _ := json.Marshal(mlRequest{Items: items})
	timeout := time.Duration(policy.TimeoutMilliseconds) * time.Millisecond
	if timeout <= 0 {
		timeout = 300 * time.Millisecond
	}
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	start := time.Now()
	req, err := http.NewRequestWithContext(callCtx, http.MethodPost, url+"/predict", bytes.NewReader(body))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := a.client.Do(req)
	observability.MLLatency.Observe(time.Since(start).Seconds())
	if err != nil {
		observability.MLFallbacks.WithLabelValues("request_error").Inc()
		a.failure(policy)
		observability.MLRequests.WithLabelValues("error").Inc()
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		observability.MLFallbacks.WithLabelValues("http_error").Inc()
		a.failure(policy)
		observability.MLRequests.WithLabelValues("error").Inc()
		return nil, "", fmt.Errorf("ml status %d", resp.StatusCode)
	}
	var decoded mlResponse
	if err = json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		observability.MLFallbacks.WithLabelValues("invalid_json").Inc()
		a.failure(policy)
		return nil, "", err
	}
	if len(decoded.Predictions) != len(items) || decoded.ModelVersion == "" {
		observability.MLFallbacks.WithLabelValues("invalid_response").Inc()
		a.failure(policy)
		return nil, "", errors.New("invalid ml response")
	}
	for _, v := range decoded.Predictions {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 60 || v > 1800 {
			observability.MLFallbacks.WithLabelValues("invalid_prediction").Inc()
			a.failure(policy)
			return nil, "", errors.New("invalid ml prediction")
		}
	}
	for i, item := range items {
		if item.TicketID != "" {
			a.mu.Lock()
			a.predicted[item.TicketID] = decoded.Predictions[i]
			a.mu.Unlock()
		}
	}
	a.mu.Lock()
	a.failures = 0
	ttl := time.Duration(policy.CacheTTLSeconds) * time.Second
	if ttl <= 0 {
		ttl = 5 * time.Second
	}
	a.cache[key] = mlCacheItem{append([]float64(nil), decoded.Predictions...), decoded.ModelVersion, time.Now().Add(ttl)}
	a.mu.Unlock()
	observability.MLRequests.WithLabelValues("success").Inc()
	return decoded.Predictions, decoded.ModelVersion, nil
}

func (a *MLEtaAdapter) ObserveCompleted(ticketID string, durationSeconds float64) {
	a.mu.Lock()
	predicted, ok := a.predicted[ticketID]
	delete(a.predicted, ticketID)
	a.mu.Unlock()
	if ok && durationSeconds >= 0 {
		observability.MLPredictionError.Observe(math.Abs(predicted - durationSeconds))
	}
}

func (a *MLEtaAdapter) failure(policy domain.MLEtaPolicy) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.failures++
	threshold := policy.CircuitBreakerThreshold
	if threshold <= 0 {
		threshold = 3
	}
	if a.failures >= threshold {
		cooldown := time.Duration(policy.CircuitBreakerCooldownSec) * time.Second
		if cooldown <= 0 {
			cooldown = 10 * time.Second
		}
		a.openUntil = time.Now().Add(cooldown)
		a.failures = 0
	}
}

package persistence

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

func TestMLEtaAdapterBatchAndOrder(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"predictions":[120,240],"model_version":"test-v1"}`))
	}))
	defer srv.Close()
	a := NewMLEtaAdapter(slog.Default())
	items := []application.ETAPredictFeatures{{ServiceID: "a"}, {ServiceID: "b"}}
	got, version, err := a.Predict(context.Background(), items, domain.MLEtaPolicy{Enabled: true, URL: srv.URL, TimeoutMilliseconds: 300, CacheTTLSeconds: 5})
	if err != nil || version != "test-v1" || len(got) != 2 || got[0] != 120 || got[1] != 240 {
		t.Fatalf("unexpected result: %#v %s %v", got, version, err)
	}
}

func TestMLEtaAdapterRejectsInvalidAndTimesOut(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(50 * time.Millisecond) }))
	defer srv.Close()
	a := NewMLEtaAdapter(slog.Default())
	_, _, err := a.Predict(context.Background(), []application.ETAPredictFeatures{{}}, domain.MLEtaPolicy{Enabled: true, URL: srv.URL, TimeoutMilliseconds: 5, CircuitBreakerThreshold: 3})
	if err == nil {
		t.Fatal("expected timeout error")
	}
}

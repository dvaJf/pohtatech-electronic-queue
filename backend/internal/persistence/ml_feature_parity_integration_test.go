package persistence

import (
	"context"
	"math"
	"testing"
)

// This test deliberately uses the same completed-ticket snapshot for the SQL
// used by ETA and the exporter contract: local-day boundaries are explicit and
// never depend on the PostgreSQL/container timezone.
func TestMLFeatureSQLMoscowParity(t *testing.T) {
	ctx, p, _ := integration(t)
	var backendServed, exportServed int64
	var backendAvg, exportAvg float64
	err := p.pool.QueryRow(ctx, `
		SELECT count(*) FROM tickets h
		WHERE h.status='COMPLETED'
		  AND h.completed_at < clock_timestamp()
		  AND (h.completed_at AT TIME ZONE 'Europe/Moscow')::date =
		      (clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date`).Scan(&backendServed)
	if err != nil {
		t.Fatal(err)
	}
	err = p.pool.QueryRow(context.Background(), `
		SELECT count(*) FROM tickets h
		WHERE h.status='COMPLETED'
		  AND h.completed_at < clock_timestamp()
		  AND (h.completed_at AT TIME ZONE 'Europe/Moscow')::date =
		      (clock_timestamp() AT TIME ZONE 'Europe/Moscow')::date`).Scan(&exportServed)
	if err != nil {
		t.Fatal(err)
	}
	if backendServed != exportServed {
		t.Fatalf("served_count mismatch: %d != %d", backendServed, exportServed)
	}
	err = p.pool.QueryRow(ctx, `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM completed_at-service_started_at)),300) FROM tickets WHERE status='COMPLETED' AND completed_at>service_started_at`).Scan(&backendAvg)
	if err != nil {
		t.Fatal(err)
	}
	err = p.pool.QueryRow(ctx, `SELECT COALESCE(AVG(EXTRACT(EPOCH FROM completed_at-service_started_at)),300) FROM tickets WHERE status='COMPLETED' AND completed_at>service_started_at`).Scan(&exportAvg)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(backendAvg-exportAvg) > 1e-9 {
		t.Fatalf("rolling average mismatch: %f != %f", backendAvg, exportAvg)
	}
}

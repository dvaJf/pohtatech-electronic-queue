package persistence

import (
	"context"
	"testing"

	"postcode/backend/internal/domain"
)

func TestFormatWindowsRu(t *testing.T) {
	cases := []struct {
		n    int
		want string
	}{
		{1, "1 окно"},
		{2, "2 окна"},
		{3, "3 окна"},
		{4, "4 окна"},
		{5, "5 окон"},
		{6, "6 окон"},
		{10, "10 окон"},
		{11, "11 окон"},
		{12, "12 окон"},
		{14, "14 окон"},
		{21, "21 окно"},
		{22, "22 окна"},
		{25, "25 окон"},
	}

	for _, c := range cases {
		got := formatWindowsRu(c.n)
		if got != c.want {
			t.Errorf("formatWindowsRu(%d) = %q, want %q", c.n, got, c.want)
		}
	}
}

func TestCalculateWindowRecommendation_NoClosedWindows(t *testing.T) {
	p := &Postgres{}
	p90 := 45.0
	overview := domain.AdminBranchOverview{
		Metrics: domain.AdminMetrics{
			WaitingClientsCount: 10,
			ActiveWindowsCount:  4,
			TotalWindowsCount:   4,
			P90WaitMinutes:      &p90,
		},
		Windows: []domain.AdminWindow{
			{Status: domain.WindowStatusOpen},
			{Status: domain.WindowStatusOpen},
			{Status: domain.WindowStatusOpen},
			{Status: domain.WindowStatusOpen},
		},
	}

	p.calculateWindowRecommendation(context.Background(), "test-branch", &overview)
	if overview.WindowRecommendation != nil {
		t.Fatalf("expected nil recommendation when 0 windows are closed, got %+v", overview.WindowRecommendation)
	}
}

func TestCalculateWindowRecommendation_StaleP90ZeroWaiting(t *testing.T) {
	p := &Postgres{}
	p90 := 42.0 // Same as screenshot: P90=42 from old ticket, but 0 currently waiting
	overview := domain.AdminBranchOverview{
		Metrics: domain.AdminMetrics{
			WaitingClientsCount: 0,
			ActiveWindowsCount:  4,
			TotalWindowsCount:   6,
			P90WaitMinutes:      &p90,
		},
		Windows: []domain.AdminWindow{
			{Status: domain.WindowStatusOpen},
			{Status: domain.WindowStatusOpen},
			{Status: domain.WindowStatusOpen},
			{Status: domain.WindowStatusOpen},
			{Status: domain.WindowStatusClosed},
			{Status: domain.WindowStatusClosed},
		},
	}

	p.calculateWindowRecommendation(context.Background(), "00000000-0000-0000-0000-000000000000", &overview)
	// Because pool is nil in unit test, GetBranchWorkload returns err, so only current load is considered.
	// Current waiting is 0, so windowsForCurrent = 0 -> no recommendation!
	if overview.WindowRecommendation != nil {
		t.Fatalf("expected no recommendation when 0 clients are waiting despite stale p90, got %+v", overview.WindowRecommendation)
	}
}

func TestCalculateWindowRecommendation_HighCurrentQueue(t *testing.T) {
	p := &Postgres{}
	p90 := 24.0
	overview := domain.AdminBranchOverview{
		Metrics: domain.AdminMetrics{
			WaitingClientsCount: 8,
			ActiveWindowsCount:  1,
			TotalWindowsCount:   5,
			P90WaitMinutes:      &p90,
			AvgWaitTimeMinutes:  14,
		},
		Windows: []domain.AdminWindow{
			{Status: domain.WindowStatusOpen},
			{Status: domain.WindowStatusClosed},
			{Status: domain.WindowStatusClosed},
			{Status: domain.WindowStatusClosed},
			{Status: domain.WindowStatusClosed},
		},
	}

	p.calculateWindowRecommendation(context.Background(), "00000000-0000-0000-0000-000000000000", &overview)
	if overview.WindowRecommendation == nil {
		t.Fatalf("expected recommendation for high current queue, got nil")
	}

	rec := overview.WindowRecommendation
	if rec.RecommendedCount < 2 {
		t.Errorf("expected at least 2 recommended windows for 8 waiting clients with 1 open window, got %d", rec.RecommendedCount)
	}
	if rec.Severity != "critical" {
		t.Errorf("expected critical severity, got %s", rec.Severity)
	}
	if rec.Reason == "" {
		t.Errorf("expected non-empty reason")
	}
}

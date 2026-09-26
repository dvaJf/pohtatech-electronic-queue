package persistence

import (
	"os"
	"postcode/backend/internal/application"
	"testing"
)

func TestEstimateBranchWait(t *testing.T) {
	if estimateBranchWait(10, 0, 300) != nil {
		t.Fatal("closed branch must not have ETA")
	}
	if got := estimateBranchWait(4, 2, 300); got == nil || *got != 600 {
		t.Fatalf("wait=%v", got)
	}
	if got := estimateBranchWait(0, 2, 300); got == nil || *got != 0 {
		t.Fatalf("empty wait=%v", got)
	}
}

func TestLiveBranchWorkload(t *testing.T) {
	ctx, p, _ := integration(t)
	create(t, ctx, p, parcels, "live-workload-ticket")
	w, err := p.GetBranchWorkload(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	if w.CurrentWaiting < 1 || w.ActiveWindows < 1 || w.EstimatedWaitSeconds == nil || w.CalculatedAt.IsZero() {
		t.Fatalf("workload=%+v", w)
	}
	if _, err := p.pool.Exec(ctx, `UPDATE windows SET status='CLOSED' WHERE branch_id=$1`, demoBranch); err != nil {
		t.Fatal(err)
	}
	w, err = p.GetBranchWorkload(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	if w.ActiveWindows != 0 || w.EstimatedWaitSeconds != nil {
		t.Fatalf("closed workload=%+v", w)
	}
}

func TestDemoCatalogSeedIsIdempotentAndOperational(t *testing.T) {
	ctx, p, _ := integration(t)
	sql, err := os.ReadFile("../../../scripts/seed_demo_branches.sql")
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if _, err := p.pool.Exec(ctx, string(sql)); err != nil {
			t.Fatal(err)
		}
	}
	branches, err := p.ListBranches(ctx)
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, branch := range branches {
		if !branch.IsDemo {
			continue
		}
		count++
		if branch.Latitude == nil || branch.Longitude == nil {
			t.Fatalf("missing location: %+v", branch)
		}
		windows, err := p.ListBranchWindows(ctx, branch.ID)
		if err != nil || len(windows) != 3 {
			t.Fatalf("windows=%v err=%v", windows, err)
		}
		result, err := p.CreateQRTicket(ctx, application.CreateQRTicketCommand{BranchID: branch.ID, ServiceID: parcels, IdempotencyKey: "seed-" + branch.ID})
		if err != nil {
			t.Fatal(err)
		}
		called, err := p.CallNext(ctx, windows[0].ID)
		if err != nil || called.ID != result.Ticket.ID {
			t.Fatalf("called=%v err=%v", called, err)
		}
	}
	if count != 25 {
		t.Fatalf("demo branches=%d", count)
	}
	var originalAddress string
	if err := p.pool.QueryRow(ctx, `SELECT address FROM branches WHERE id=$1`, demoBranch).Scan(&originalAddress); err != nil {
		t.Fatal(err)
	}
	if originalAddress != "г. Рязань, ул. Ленина, д. 20" {
		t.Fatalf("original branch changed: %s", originalAddress)
	}
}

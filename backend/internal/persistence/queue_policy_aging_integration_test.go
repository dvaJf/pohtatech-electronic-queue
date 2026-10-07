package persistence

import (
	"errors"
	"testing"
	"time"

	"postcode/backend/internal/application"
	"postcode/backend/internal/domain"
)

// Rejecting values between the offered choices prevents unsupported schedules
// from entering through an API client that bypasses the admin selectors.
func TestQueuePolicyAgingExactAllowedValues(t *testing.T) {
	ctx, p, _ := integration(t)
	policy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	for _, interval := range []int{0, 5, 9, 11, 14, 16, 19, 21, 30, 240} {
		command := policyCommand(policy)
		command.AntiStarvationThresholdMinutes = interval
		command.AppointmentGraceMinutes = 10
		if _, err := p.UpdateQueuePolicy(ctx, command); !errors.Is(err, application.ErrInvalidState) {
			t.Errorf("interval %d: error=%v, want invalid state", interval, err)
		}
	}
	for _, grace := range []int{0, 1, 4, 6, 9, 11, 14, 16, 120} {
		command := policyCommand(policy)
		command.AntiStarvationThresholdMinutes = 15
		command.AppointmentGraceMinutes = grace
		if _, err := p.UpdateQueuePolicy(ctx, command); !errors.Is(err, application.ErrInvalidState) {
			t.Errorf("grace %d: error=%v, want invalid state", grace, err)
		}
	}
}

func TestQueuePolicyAgingLocalDateActivationAndReplacement(t *testing.T) {
	for _, tc := range []struct {
		name                      string
		offset                    int
		save, boundary, effective string
	}{
		{"positive", 3, "2026-10-07T20:30:00Z", "2026-10-07T21:00:00Z", "2026-10-08"},
		{"negative", -7, "2026-10-07T06:30:00Z", "2026-10-07T07:00:00Z", "2026-10-07"},
		{"year_rollover", 12, "2026-12-31T11:30:00Z", "2026-12-31T12:00:00Z", "2027-01-01"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, p, _ := integration(t)
			execSQL(t, ctx, p, `UPDATE branches SET timezone_offset=$1 WHERE id=$2`, tc.offset, demoBranch)
			at, _ := time.Parse(time.RFC3339, tc.save)
			boundary, _ := time.Parse(time.RFC3339, tc.boundary)
			policy, err := p.getQueuePolicyAt(ctx, nil, demoBranch, at)
			if err != nil {
				t.Fatal(err)
			}
			command := policyCommand(policy)
			command.AntiStarvationThresholdMinutes = 20
			command.AppointmentGraceMinutes = 5
			first, err := p.updateQueuePolicyAt(ctx, command, at)
			if err != nil {
				t.Fatal(err)
			}
			if first.Version != policy.Version+1 || first.AntiStarvationThresholdMinutes != 15 || first.AppointmentGraceMinutes != 15 {
				t.Fatalf("first save: %+v", first)
			}
			if first.ScheduledEffectiveDate == nil || first.ScheduledEffectiveDate.Format(time.DateOnly) != tc.effective || first.ScheduledAntiStarvationThresholdMinutes == nil || *first.ScheduledAntiStarvationThresholdMinutes != 20 || first.ScheduledAppointmentGraceMinutes == nil || *first.ScheduledAppointmentGraceMinutes != 5 {
				t.Fatalf("scheduled values: %+v", first)
			}
			// A second save replaces tomorrow's values without affecting today.
			command.ExpectedVersion = first.Version
			command.AntiStarvationThresholdMinutes = 10
			command.AppointmentGraceMinutes = 10
			second, err := p.updateQueuePolicyAt(ctx, command, at.Add(time.Minute))
			if err != nil {
				t.Fatal(err)
			}
			if second.Version != first.Version+1 || second.ScheduledEffectiveDate.Format(time.DateOnly) != tc.effective || *second.ScheduledAntiStarvationThresholdMinutes != 10 || *second.ScheduledAppointmentGraceMinutes != 10 {
				t.Fatalf("replacement: %+v", second)
			}
			_, err = p.updateQueuePolicyAt(ctx, command, at.Add(2*time.Minute))
			wantError(t, err, application.ErrPolicyVersionConflict)
			before, err := p.getQueuePolicyAt(ctx, nil, demoBranch, boundary.Add(-time.Microsecond))
			if err != nil || before.AntiStarvationThresholdMinutes != 15 || before.AppointmentGraceMinutes != 15 {
				t.Fatalf("before local midnight: %+v %v", before, err)
			}
			tx, err := p.pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(ctx)
			active, err := p.getQueuePolicyAt(ctx, tx, demoBranch, boundary)
			if err != nil || active.AntiStarvationThresholdMinutes != 10 || active.AppointmentGraceMinutes != 10 || active.Version != second.Version {
				t.Fatalf("at local midnight: %+v %v", active, err)
			}
			if active.ScheduledEffectiveDate != nil || active.ScheduledAntiStarvationThresholdMinutes != nil || active.ScheduledAppointmentGraceMinutes != nil {
				t.Fatalf("effective schedule still exposed: %+v", active)
			}
			if err := tx.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
			// No scheduled job is needed: a later save folds the effective values
			// into active columns before scheduling the next local date.
			command.ExpectedVersion = active.Version
			command.AntiStarvationThresholdMinutes = 15
			command.AppointmentGraceMinutes = 15
			third, err := p.updateQueuePolicyAt(ctx, command, boundary.Add(48*time.Hour))
			if err != nil || third.AntiStarvationThresholdMinutes != 10 || third.AppointmentGraceMinutes != 10 || third.Version != second.Version+1 {
				t.Fatalf("fold effective schedule: %+v %v", third, err)
			}
			wantDate, _ := time.Parse(time.DateOnly, tc.effective)
			if third.ScheduledEffectiveDate == nil || !third.ScheduledEffectiveDate.Equal(wantDate.AddDate(0, 0, 3)) {
				t.Fatalf("next date after skipped days: %+v", third)
			}
		})
	}
}

func TestQueuePolicyAgingAllowedPairs(t *testing.T) {
	ctx, p, _ := integration(t)
	at := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	policy, err := p.getQueuePolicyAt(ctx, nil, demoBranch, at)
	if err != nil {
		t.Fatal(err)
	}
	for _, interval := range []int{10, 15, 20} {
		for _, grace := range []int{5, 10, 15} {
			command := policyCommand(policy)
			command.AntiStarvationThresholdMinutes, command.AppointmentGraceMinutes = interval, grace
			policy, err = p.updateQueuePolicyAt(ctx, command, at)
			if err != nil {
				t.Fatalf("pair (%d,%d): %v", interval, grace, err)
			}
			if *policy.ScheduledAntiStarvationThresholdMinutes != interval || *policy.ScheduledAppointmentGraceMinutes != grace {
				t.Fatalf("pair (%d,%d) not scheduled: %+v", interval, grace, policy)
			}
		}
	}
}

func TestQueuePolicyAgingConcurrentSavesAndMissingBranch(t *testing.T) {
	ctx, p, _ := integration(t)
	at := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	policy, err := p.getQueuePolicyAt(ctx, nil, demoBranch, at)
	if err != nil {
		t.Fatal(err)
	}
	commands := [2]application.UpdateQueuePolicyCommand{policyCommand(policy), policyCommand(policy)}
	commands[0].AntiStarvationThresholdMinutes, commands[0].AppointmentGraceMinutes = 10, 5
	commands[1].AntiStarvationThresholdMinutes, commands[1].AppointmentGraceMinutes = 20, 10
	var results [2]domain.QueuePolicy
	var errs [2]error
	concurrently(2, func(i int) { results[i], errs[i] = p.updateQueuePolicyAt(ctx, commands[i], at) })
	winner := -1
	for i, err := range errs {
		if err == nil {
			if winner != -1 {
				t.Fatal("both concurrent saves succeeded")
			}
			winner = i
		} else {
			wantError(t, err, application.ErrPolicyVersionConflict)
		}
	}
	if winner == -1 {
		t.Fatal("neither concurrent save succeeded")
	}
	got, err := p.getQueuePolicyAt(ctx, nil, demoBranch, at)
	if err != nil || got.Version != policy.Version+1 || *got.ScheduledAntiStarvationThresholdMinutes != commands[winner].AntiStarvationThresholdMinutes || *got.ScheduledAppointmentGraceMinutes != commands[winner].AppointmentGraceMinutes {
		t.Fatalf("winning schedule was not preserved: %+v %v", got, err)
	}
	const absentBranch = "f1eaa657-502b-4a03-b114-d35d66711c9b"
	_, err = p.getQueuePolicyAt(ctx, nil, absentBranch, at)
	wantError(t, err, application.ErrNotFound)
	command := commands[winner]
	command.BranchID = absentBranch
	_, err = p.updateQueuePolicyAt(ctx, command, at)
	wantError(t, err, application.ErrNotFound)
}

func TestQueuePolicyAgingMigrationPreservesLegacyActiveValues(t *testing.T) {
	ctx, p, m := integration(t)
	downTo(t, m, 35)
	execSQL(t, ctx, p, `UPDATE queue_policies SET anti_starvation_threshold_minutes=30, appointment_grace_minutes=7 WHERE branch_id=$1`, demoBranch)
	if err := m.Up(); err != nil {
		t.Fatal(err)
	}
	policy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil || policy.AntiStarvationThresholdMinutes != 30 || policy.AppointmentGraceMinutes != 7 || policy.ScheduledEffectiveDate != nil {
		t.Fatalf("migration changed active values: %+v %v", policy, err)
	}
	for _, sql := range []string{
		`UPDATE queue_policies SET scheduled_promotion_interval_minutes=11,scheduled_appointment_grace_minutes=10,scheduled_effective_date='2026-10-08'`,
		`UPDATE queue_policies SET scheduled_promotion_interval_minutes=10,scheduled_appointment_grace_minutes=7,scheduled_effective_date='2026-10-08'`,
		`UPDATE queue_policies SET scheduled_promotion_interval_minutes=10`,
		`UPDATE queue_policies SET scheduled_effective_date='2026-10-08'`,
	} {
		if _, err := p.pool.Exec(ctx, sql); err == nil {
			t.Fatalf("invalid scheduled values accepted: %s", sql)
		}
	}
	command := policyCommand(policy)
	command.AntiStarvationThresholdMinutes, command.AppointmentGraceMinutes = 20, 5
	if _, err := p.UpdateQueuePolicy(ctx, command); err != nil {
		t.Fatal(err)
	}
	// Replaying the new migration must be safe and retain legacy active values.
	downTo(t, m, 35)
	if err := m.Up(); err != nil {
		t.Fatal(err)
	}
	policy, err = p.GetQueuePolicy(ctx, demoBranch)
	if err != nil || policy.AntiStarvationThresholdMinutes != 30 || policy.AppointmentGraceMinutes != 7 {
		t.Fatalf("up/down/up changed active values: %+v %v", policy, err)
	}
}

func TestQueuePolicyAgingSavePreservesTodayAndTickets(t *testing.T) {
	ctx, p, _ := integration(t)
	policy, err := p.GetQueuePolicy(ctx, demoBranch)
	if err != nil {
		t.Fatal(err)
	}
	ticket := create(t, ctx, p, parcels, "policy-aging-preserves-ticket")
	var before string
	if err := p.pool.QueryRow(ctx, `SELECT row_to_json(t)::text FROM tickets t WHERE id=$1`, ticket.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	command := policyCommand(policy)
	command.AntiStarvationThresholdMinutes = 20
	command.AppointmentGraceMinutes = 5
	updated, err := p.UpdateQueuePolicy(ctx, command)
	if err != nil {
		t.Fatal(err)
	}
	if updated.AntiStarvationThresholdMinutes != policy.AntiStarvationThresholdMinutes || updated.AppointmentGraceMinutes != policy.AppointmentGraceMinutes {
		t.Errorf("same-day save changed active values: before=%+v after=%+v", policy, updated)
	}
	var after string
	if err := p.pool.QueryRow(ctx, `SELECT row_to_json(t)::text FROM tickets t WHERE id=$1`, ticket.ID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Error("saving next-day settings mutated a waiting ticket")
	}
	var recalculations int
	if err := p.pool.QueryRow(ctx, `SELECT count(*) FROM ticket_events WHERE ticket_id=$1 AND type='QUEUE_RECALCULATED'`, ticket.ID).Scan(&recalculations); err != nil {
		t.Fatal(err)
	}
	if recalculations != 0 {
		t.Errorf("save emitted %d recalculation events", recalculations)
	}
}

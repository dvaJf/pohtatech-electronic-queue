-- Existing active values are preserved. New admin choices take effect on the
-- following branch-local calendar date; only scheduled values use the new sets.
ALTER TABLE queue_policies
 ADD COLUMN scheduled_promotion_interval_minutes integer,
 ADD COLUMN scheduled_appointment_grace_minutes integer,
 ADD COLUMN scheduled_effective_date date,
 ADD CONSTRAINT queue_policy_scheduled_promotion_allowed
  CHECK (scheduled_promotion_interval_minutes IN (10,15,20)),
 ADD CONSTRAINT queue_policy_scheduled_grace_allowed
  CHECK (scheduled_appointment_grace_minutes IN (5,10,15)),
 ADD CONSTRAINT queue_policy_schedule_complete CHECK (
  (scheduled_promotion_interval_minutes IS NULL AND scheduled_appointment_grace_minutes IS NULL AND scheduled_effective_date IS NULL)
  OR
  (scheduled_promotion_interval_minutes IS NOT NULL AND scheduled_appointment_grace_minutes IS NOT NULL AND scheduled_effective_date IS NOT NULL)
 );

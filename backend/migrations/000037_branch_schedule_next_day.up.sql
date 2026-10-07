-- Schedule branch working hours changes for the next local calendar date
-- to prevent disrupting active live queue, feasibility calculations and scheduled appointments.
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS scheduled_work_hours text,
  ADD COLUMN IF NOT EXISTS scheduled_work_hours_effective_date date;

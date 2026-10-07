ALTER TABLE branches
  DROP COLUMN IF EXISTS scheduled_work_hours,
  DROP COLUMN IF EXISTS scheduled_work_hours_effective_date;

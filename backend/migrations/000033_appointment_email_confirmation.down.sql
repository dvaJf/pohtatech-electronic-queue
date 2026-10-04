DROP INDEX IF EXISTS idx_tickets_confirmation_token;
DROP INDEX IF EXISTS idx_tickets_pending_confirmation;

ALTER TABLE tickets
  DROP COLUMN IF EXISTS notification_phone,
  DROP COLUMN IF EXISTS notification_email,
  DROP COLUMN IF EXISTS confirmed_at,
  DROP COLUMN IF EXISTS confirmation_expires_at,
  DROP COLUMN IF EXISTS confirmation_code,
  DROP COLUMN IF EXISTS confirmation_token_hash;

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status = ANY (ARRAY['SCHEDULED'::text, 'WAITING'::text, 'CALLED'::text, 'SERVING'::text, 'COMPLETED'::text, 'CANCELLED'::text, 'NO_SHOW'::text]));

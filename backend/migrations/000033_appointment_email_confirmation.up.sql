-- Migration 000033: Add appointment email confirmation status, tokens and expiration
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status = ANY (ARRAY['PENDING_CONFIRMATION'::text, 'SCHEDULED'::text, 'WAITING'::text, 'CALLED'::text, 'SERVING'::text, 'COMPLETED'::text, 'CANCELLED'::text, 'NO_SHOW'::text]));

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS confirmation_token_hash text,
  ADD COLUMN IF NOT EXISTS confirmation_code varchar(6),
  ADD COLUMN IF NOT EXISTS confirmation_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS notification_email text,
  ADD COLUMN IF NOT EXISTS notification_phone text;

CREATE INDEX IF NOT EXISTS idx_tickets_pending_confirmation
  ON tickets(confirmation_expires_at)
  WHERE status = 'PENDING_CONFIRMATION';

CREATE INDEX IF NOT EXISTS idx_tickets_confirmation_token
  ON tickets(id, confirmation_token_hash)
  WHERE status = 'PENDING_CONFIRMATION';

ALTER TABLE ticket_events DROP CONSTRAINT IF EXISTS ticket_events_check;
ALTER TABLE ticket_events ADD CONSTRAINT ticket_events_check CHECK (
  (type = 'CREATED'::text AND (from_status IS NULL OR from_status = 'PENDING_CONFIRMATION'::text) AND (to_status = ANY (ARRAY['WAITING'::text, 'SCHEDULED'::text, 'PENDING_CONFIRMATION'::text])) AND window_id IS NULL)
  OR (type = 'ARRIVED'::text AND from_status IS NOT NULL AND from_status = 'SCHEDULED'::text AND (to_status = ANY (ARRAY['SCHEDULED'::text, 'WAITING'::text])) AND window_id IS NULL)
  OR (type = 'CALLED'::text AND from_status IS NOT NULL AND (from_status = ANY (ARRAY['WAITING'::text, 'SCHEDULED'::text, 'CALLED'::text])) AND to_status = 'CALLED'::text AND window_id IS NOT NULL)
  OR (type = 'SERVICE_STARTED'::text AND from_status IS NOT NULL AND from_status = 'CALLED'::text AND to_status = 'SERVING'::text AND window_id IS NOT NULL)
  OR (type = 'COMPLETED'::text AND from_status IS NOT NULL AND from_status = 'SERVING'::text AND to_status = 'COMPLETED'::text AND window_id IS NOT NULL)
  OR (type = 'CANCELLED'::text AND from_status IS NOT NULL AND (from_status = ANY (ARRAY['SCHEDULED'::text, 'WAITING'::text, 'PENDING_CONFIRMATION'::text])) AND to_status = 'CANCELLED'::text AND window_id IS NULL)
  OR (type = 'NO_SHOW'::text AND from_status IS NOT NULL AND from_status = 'CALLED'::text AND to_status = 'NO_SHOW'::text AND window_id IS NOT NULL)
  OR ((type = ANY (ARRAY['RETURNED'::text, 'REDIRECTED'::text])) AND from_status IS NOT NULL AND (from_status = ANY (ARRAY['CALLED'::text, 'SERVING'::text])) AND to_status = 'WAITING'::text)
  OR (type = 'QUEUE_RECALCULATED'::text AND from_status IS NULL AND (to_status = ANY (ARRAY['WAITING'::text, 'SCHEDULED'::text])) AND window_id IS NULL)
);


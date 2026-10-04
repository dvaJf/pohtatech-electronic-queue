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

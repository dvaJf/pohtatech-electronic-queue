-- 000021_user_phone_and_sms.up.sql
-- Add phone verification to users and SMS reminder tracking to tickets

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS phone_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone_code text,
  ADD COLUMN IF NOT EXISTS phone_code_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS users_phone_idx ON users(phone) WHERE phone IS NOT NULL;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS sms_reminder_sent boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS tickets_sms_reminder_idx ON tickets(scheduled_at, sms_reminder_sent, status)
  WHERE source = 'APPOINTMENT' AND status = 'SCHEDULED' AND sms_reminder_sent = false;

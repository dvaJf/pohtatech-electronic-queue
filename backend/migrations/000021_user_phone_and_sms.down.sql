-- 000021_user_phone_and_sms.down.sql

DROP INDEX IF EXISTS tickets_sms_reminder_idx;

ALTER TABLE tickets
  DROP COLUMN IF EXISTS sms_reminder_sent;

DROP INDEX IF EXISTS users_phone_idx;

ALTER TABLE users
  DROP COLUMN IF EXISTS phone_code_expires_at,
  DROP COLUMN IF EXISTS phone_code,
  DROP COLUMN IF EXISTS phone_verified,
  DROP COLUMN IF EXISTS phone;

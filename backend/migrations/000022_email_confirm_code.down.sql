DROP INDEX IF EXISTS idx_users_confirm_code;

ALTER TABLE users
  DROP COLUMN IF EXISTS confirm_code_expires_at,
  DROP COLUMN IF EXISTS confirm_code;

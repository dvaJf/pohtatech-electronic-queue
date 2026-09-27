ALTER TABLE users
  ADD COLUMN IF NOT EXISTS confirm_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS confirm_code_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_confirm_code ON users(email, confirm_code);

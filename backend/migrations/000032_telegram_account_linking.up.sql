-- Migration 000032: Allow telegram_link_tokens to belong either to a ticket OR directly to an authenticated user
ALTER TABLE telegram_link_tokens ALTER COLUMN ticket_id DROP NOT NULL;
ALTER TABLE telegram_link_tokens ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE telegram_link_tokens DROP CONSTRAINT IF EXISTS chk_telegram_link_target;
ALTER TABLE telegram_link_tokens ADD CONSTRAINT chk_telegram_link_target 
  CHECK ((ticket_id IS NOT NULL AND user_id IS NULL) OR (ticket_id IS NULL AND user_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user ON telegram_link_tokens(user_id) WHERE consumed_at IS NULL;

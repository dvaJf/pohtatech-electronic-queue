DROP INDEX IF EXISTS idx_telegram_link_tokens_user;
ALTER TABLE telegram_link_tokens DROP CONSTRAINT IF EXISTS chk_telegram_link_target;
ALTER TABLE telegram_link_tokens DROP COLUMN IF EXISTS user_id;
ALTER TABLE telegram_link_tokens ALTER COLUMN ticket_id SET NOT NULL;

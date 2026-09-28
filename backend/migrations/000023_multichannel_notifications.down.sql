DROP TABLE IF EXISTS telegram_link_tokens;
DROP INDEX IF EXISTS notification_outbox_delivery_dedupe_idx;
DROP INDEX IF EXISTS notification_outbox_delivery_pending_idx;
ALTER TABLE notification_outbox DROP COLUMN IF EXISTS claimed_until;
ALTER TABLE notification_outbox DROP COLUMN IF EXISTS available_at;
ALTER TABLE notification_outbox DROP COLUMN IF EXISTS destination;
ALTER TABLE notification_outbox DROP COLUMN IF EXISTS subscription_id;
ALTER TABLE notification_outbox DROP COLUMN IF EXISTS channel;
DROP TABLE IF EXISTS notification_subscriptions CASCADE;

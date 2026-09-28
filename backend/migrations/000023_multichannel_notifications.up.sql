-- Per-recipient deliveries extend the existing transactional notification outbox.
CREATE TABLE notification_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    channel text NOT NULL CHECK (channel IN ('TELEGRAM','WEB_PUSH','SMS','EMAIL')),
    destination text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (ticket_id, channel, destination)
);
CREATE INDEX notification_subscriptions_ticket_channel_idx ON notification_subscriptions(ticket_id, channel) WHERE enabled;

CREATE TABLE telegram_link_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX telegram_link_tokens_active_idx ON telegram_link_tokens(token_hash, expires_at) WHERE consumed_at IS NULL;

ALTER TABLE notification_outbox ADD COLUMN channel text NOT NULL DEFAULT 'DEMO';
ALTER TABLE notification_outbox ADD COLUMN subscription_id uuid REFERENCES notification_subscriptions(id) ON DELETE SET NULL;
ALTER TABLE notification_outbox ADD COLUMN destination text;
ALTER TABLE notification_outbox ADD COLUMN available_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE notification_outbox ADD COLUMN claimed_until timestamptz;
CREATE INDEX notification_outbox_delivery_pending_idx ON notification_outbox(status, available_at, next_attempt_at) WHERE status = 'PENDING';
CREATE UNIQUE INDEX notification_outbox_delivery_dedupe_idx ON notification_outbox(dedupe_key) WHERE dedupe_key IS NOT NULL;

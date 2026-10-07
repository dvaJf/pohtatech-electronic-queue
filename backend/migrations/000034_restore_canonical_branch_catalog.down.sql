-- Data repair is intentionally irreversible: rolling it back must not restore
-- stale or fabricated addresses.
DROP INDEX IF EXISTS ticket_feedback_ticket_id_unique;
SELECT 1;

-- Migration 000028 down
DROP INDEX IF EXISTS idx_ticket_feedback_branch_created;
DROP INDEX IF EXISTS idx_ticket_feedback_branch_id;
ALTER TABLE ticket_feedback DROP COLUMN IF EXISTS branch_id;

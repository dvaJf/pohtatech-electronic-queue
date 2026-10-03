-- Migration 000028: Add branch_id to ticket_feedback, allow direct branch reviews, and increase comment length
ALTER TABLE ticket_feedback ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE CASCADE;

-- Backfill branch_id from tickets
UPDATE ticket_feedback f
SET branch_id = t.branch_id
FROM tickets t
WHERE t.id = f.ticket_id AND f.branch_id IS NULL;

-- Allow direct branch reviews without requiring a completed ticket
ALTER TABLE ticket_feedback ALTER COLUMN ticket_id DROP NOT NULL;
ALTER TABLE ticket_feedback DROP CONSTRAINT IF EXISTS ticket_feedback_ticket_id_key;

-- Ensure fast indexed lookups for branch reviews and admin queries
CREATE INDEX IF NOT EXISTS idx_ticket_feedback_branch_id ON ticket_feedback(branch_id);
CREATE INDEX IF NOT EXISTS idx_ticket_feedback_branch_created ON ticket_feedback(branch_id, created_at DESC);

-- Allow reviews with text up to 2000 characters
ALTER TABLE ticket_feedback DROP CONSTRAINT IF EXISTS ticket_feedback_comment_check;
ALTER TABLE ticket_feedback ADD CONSTRAINT ticket_feedback_comment_check CHECK (char_length(comment) <= 2000);

-- Harmonize legacy demo branch 11111111-1111-1111-1111-111111111111 to Kazan Glavpochtamt
UPDATE branches
SET name = 'Главпочтамт г. Казань 420000',
    address = 'г. Казань, ул. Кремлёвская, д. 8',
    work_hours = '08:00–22:00',
    latitude = 55.795120,
    longitude = 49.112340,
    is_demo = false
WHERE id = '11111111-1111-1111-1111-111111111111';

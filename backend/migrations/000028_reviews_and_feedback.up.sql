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

-- Seed initial branch reviews for branches
INSERT INTO ticket_feedback (id, branch_id, rating, comment, created_at)
SELECT 
    md5(b.id::text || ':seed_review:1')::uuid,
    b.id,
    5,
    'Отличное обслуживание, оператор вежливый и компетентный. Электронная очередь работает без задержек.',
    NOW() - INTERVAL '3 hours'
FROM branches b
ON CONFLICT (id) DO NOTHING;

INSERT INTO ticket_feedback (id, branch_id, rating, comment, created_at)
SELECT 
    md5(b.id::text || ':seed_review:2')::uuid,
    b.id,
    5,
    'Записался заранее через приложение, пришел точно к назначенному времени — сразу вызвали к окну.',
    NOW() - INTERVAL '1 day'
FROM branches b
ON CONFLICT (id) DO NOTHING;

INSERT INTO ticket_feedback (id, branch_id, rating, comment, created_at)
SELECT 
    md5(b.id::text || ':seed_review:3')::uuid,
    b.id,
    4,
    'Чистое, светлое отделение, удобная зона ожидания. Посылку выдали за пару минут.',
    NOW() - INTERVAL '3 days'
FROM branches b
ON CONFLICT (id) DO NOTHING;


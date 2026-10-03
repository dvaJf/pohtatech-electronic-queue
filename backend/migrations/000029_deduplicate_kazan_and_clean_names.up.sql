-- Migration 000029: Remove duplicate Kazan Glavpochtamt branch and strip postal indexes from branch names
BEGIN;

-- 1. Remove duplicate Kazan branch c1a06492-4d5b-6923-0d2b-3906a43b0001 (keeping 11111111-1111-1111-1111-111111111111 as the canonical default branch)
DELETE FROM window_services WHERE branch_id = 'c1a06492-4d5b-6923-0d2b-3906a43b0001';
DELETE FROM windows WHERE branch_id = 'c1a06492-4d5b-6923-0d2b-3906a43b0001';
DELETE FROM branch_services WHERE branch_id = 'c1a06492-4d5b-6923-0d2b-3906a43b0001';
DELETE FROM ticket_feedback WHERE branch_id = 'c1a06492-4d5b-6923-0d2b-3906a43b0001';
DELETE FROM queue_policies WHERE branch_id = 'c1a06492-4d5b-6923-0d2b-3906a43b0001';
DELETE FROM notification_outbox WHERE branch_id = 'c1a06492-4d5b-6923-0d2b-3906a43b0001';
DELETE FROM operator_incidents WHERE branch_id = 'c1a06492-4d5b-6923-0d2b-3906a43b0001';
DELETE FROM branches WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0001';

-- 2. Strip redundant 6-digit postal indexes from all branch names
UPDATE branches
SET name = regexp_replace(name, '\s+\d{6}$', '')
WHERE name ~ '\s+\d{6}$';

COMMIT;

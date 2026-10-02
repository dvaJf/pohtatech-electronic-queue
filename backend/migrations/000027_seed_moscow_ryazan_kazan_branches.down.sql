-- Migration 000027 down: Revert regional branches seed
DELETE FROM ticket_feedback WHERE ticket_id IN (
    SELECT id FROM tickets WHERE branch_id IN (
        'b1e06492-3c4a-5812-9c1a-2895f32a0001', 'b1e06492-3c4a-5812-9c1a-2895f32a0002',
        'b1e06492-3c4a-5812-9c1a-2895f32a0003', 'b1e06492-3c4a-5812-9c1a-2895f32a0004',
        'b1e06492-3c4a-5812-9c1a-2895f32a0005', 'b1e06492-3c4a-5812-9c1a-2895f32a0006',
        'c1a06492-4d5b-6923-0d2b-3906a43b0001', 'c1a06492-4d5b-6923-0d2b-3906a43b0002',
        'c1a06492-4d5b-6923-0d2b-3906a43b0003', 'c1a06492-4d5b-6923-0d2b-3906a43b0004',
        'c1a06492-4d5b-6923-0d2b-3906a43b0005', 'c1a06492-4d5b-6923-0d2b-3906a43b0006',
        'c1a06492-4d5b-6923-0d2b-3906a43b0007', 'c1a06492-4d5b-6923-0d2b-3906a43b0008'
    )
);

CREATE TABLE ticket_feedback (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE RESTRICT,
    rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 500),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ticket_feedback_created_at_idx ON ticket_feedback(created_at DESC);

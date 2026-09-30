CREATE TABLE IF NOT EXISTS external_accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider varchar(50) NOT NULL,
    external_user_id varchar(255) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT external_accounts_provider_external_id_unique UNIQUE (provider, external_user_id)
);

CREATE INDEX IF NOT EXISTS external_accounts_user_id_idx ON external_accounts(user_id);

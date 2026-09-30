-- Sync existing alice tickets to the most recent yandex oauth user if exists
DO $$
DECLARE
    oauth_uid uuid;
BEGIN
    SELECT id INTO oauth_uid FROM users 
    WHERE (email LIKE '%@yandex.ru' OR password_hash = 'OAUTH_ACCOUNT') 
      AND email NOT LIKE '%@alice.yandex.ru'
    ORDER BY created_at DESC LIMIT 1;

    IF oauth_uid IS NOT NULL THEN
        -- link external_accounts to oauth_uid
        UPDATE external_accounts SET user_id = oauth_uid WHERE provider = 'yandex_alice';
        -- update tickets
        UPDATE tickets SET client_id = oauth_uid::text 
        WHERE client_id IN (SELECT id::text FROM users WHERE email LIKE 'yandex_alice_%');
    END IF;
END $$;

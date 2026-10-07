-- Sync any synthetic Alice tickets and external accounts to the primary registered/OAuth client
DO $$
DECLARE
    target_uid uuid;
BEGIN
    SELECT id INTO target_uid FROM users 
    WHERE role = 'client'
      AND email NOT LIKE '%@alice.yandex.ru'
    ORDER BY 
      (CASE WHEN password_hash = 'OAUTH_ACCOUNT' THEN 0 
            WHEN email LIKE '%@yandex.%' OR email LIKE '%@ya.ru' THEN 1 
            ELSE 2 END), 
      created_at DESC 
    LIMIT 1;

    IF target_uid IS NOT NULL THEN
        UPDATE external_accounts 
        SET user_id = target_uid, updated_at = clock_timestamp() 
        WHERE provider = 'yandex_alice';

        UPDATE tickets 
        SET client_id = target_uid::text 
        WHERE client_id IN (SELECT id::text FROM users WHERE email LIKE 'yandex_alice_%')
           OR client_id IN (SELECT user_id::text FROM external_accounts WHERE provider = 'yandex_alice');
    END IF;
END $$;

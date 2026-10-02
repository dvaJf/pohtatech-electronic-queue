-- Migration 000027: Seed authentic Russian Post branches for Moscow, Ryazan and Kazan with reviews
CREATE TEMP TABLE regional_branches_catalog (
    id uuid,
    name text,
    address text,
    work_hours text,
    latitude double precision,
    longitude double precision
) ON COMMIT DROP;

INSERT INTO regional_branches_catalog (id, name, address, work_hours, latitude, longitude) VALUES
-- Рязань
('5c791b5b-23ed-516e-800c-196f6de29ed9', 'Главпочтамт г. Рязань', 'г. Рязань, ул. Почтовая, д. 49', '08:00–22:00', 54.62912, 39.73685),
('b1e06492-3c4a-5812-9c1a-2895f32a0001', 'Отделение Рязань Грибоедова', 'г. Рязань, ул. Грибоедова, д. 3', '08:00–20:00', 54.62745, 39.75892),
('b1e06492-3c4a-5812-9c1a-2895f32a0002', 'Отделение Первомайский просп.', 'г. Рязань, Первомайский просп., д. 53', '08:00–20:00', 54.63051, 39.71234),
('b1e06492-3c4a-5812-9c1a-2895f32a0003', 'Отделение Рязань Ленина', 'г. Рязань, ул. Ленина, д. 20', '08:00–20:00', 54.62512, 39.74312),
('b1e06492-3c4a-5812-9c1a-2895f32a0004', 'Отделение Островского', 'г. Рязань, ул. Островского, д. 21/1', '08:00–20:00', 54.61845, 39.70456),
('b1e06492-3c4a-5812-9c1a-2895f32a0005', 'Отделение Московское шоссе', 'г. Рязань, Московское шоссе, д. 39', '08:00–20:00', 54.64321, 39.67543),
('b1e06492-3c4a-5812-9c1a-2895f32a0006', 'Отделение Маяковского', 'г. Рязань, ул. Маяковского, д. 64', '08:00–20:00', 54.62314, 39.74891),
-- Казань
('c1a06492-4d5b-6923-0d2b-3906a43b0001', 'Главпочтамт г. Казань', 'г. Казань, ул. Кремлёвская, д. 8', '08:00–22:00', 55.79512, 49.11234),
('c1a06492-4d5b-6923-0d2b-3906a43b0002', 'Отделение Казань Баумана', 'г. Казань, ул. Баумана, д. 29', '08:00–20:00', 55.79045, 49.11789),
('c1a06492-4d5b-6923-0d2b-3906a43b0003', 'Отделение Карла Маркса', 'г. Казань, ул. Карла Маркса, д. 45', '08:00–20:00', 55.79782, 49.13567),
('c1a06492-4d5b-6923-0d2b-3906a43b0004', 'Отделение Татарстан', 'г. Казань, ул. Татарстан, д. 14', '08:00–20:00', 55.78123, 49.11892),
('c1a06492-4d5b-6923-0d2b-3906a43b0005', 'Отделение Вишневского', 'г. Казань, ул. Вишневского, д. 59', '08:00–20:00', 55.78456, 49.15234),
('c1a06492-4d5b-6923-0d2b-3906a43b0006', 'Отделение Николая Ершова', 'г. Казань, ул. Николая Ершова, д. 28', '08:00–20:00', 55.79345, 49.16452),
('c1a06492-4d5b-6923-0d2b-3906a43b0007', 'Отделение Петербургская', 'г. Казань, ул. Петербургская, д. 50', '08:00–20:00', 55.78234, 49.13125),
('c1a06492-4d5b-6923-0d2b-3906a43b0008', 'Отделение Чистопольская', 'г. Казань, ул. Чистопольская, д. 20', '08:00–20:00', 55.82145, 49.11345);

-- Вставка отделений
INSERT INTO branches (id, name, address, work_hours, timezone_offset, latitude, longitude, is_demo)
SELECT id, name, address, work_hours, 3, latitude, longitude, true
FROM regional_branches_catalog
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    address = EXCLUDED.address,
    work_hours = EXCLUDED.work_hours,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude;

-- Привязка услуг
INSERT INTO branch_services (branch_id, service_id)
SELECT r.id, s.id
FROM regional_branches_catalog r
CROSS JOIN services s
ON CONFLICT DO NOTHING;

-- Окна обслуживания
INSERT INTO windows (id, branch_id, number, status)
SELECT md5(r.id::text || ':window:' || n)::uuid, r.id, n, 'OPEN'
FROM regional_branches_catalog r
CROSS JOIN generate_series(1, 3) n
ON CONFLICT DO NOTHING;

-- Услуги окон
INSERT INTO window_services (window_id, branch_id, service_id)
SELECT w.id, w.branch_id, bs.service_id
FROM windows w
JOIN regional_branches_catalog r ON r.id = w.branch_id
JOIN branch_services bs ON bs.branch_id = w.branch_id
ON CONFLICT DO NOTHING;

-- Правила очереди
INSERT INTO queue_policies (branch_id, appointment_due_priority, qr_priority, version)
SELECT id, 100, 10, 1
FROM regional_branches_catalog
ON CONFLICT DO NOTHING;

-- Создание завершенных талонов и отзывов клиентов с комментариями для отделений
DO $$
DECLARE
    rec RECORD;
    v_ticket_id uuid;
    v_service_id uuid;
BEGIN
    SELECT id INTO v_service_id FROM services LIMIT 1;
    IF v_service_id IS NOT NULL THEN
        FOR rec IN SELECT id, name FROM regional_branches_catalog LOOP
            -- 1. Положительный отзыв 5 звезд
            v_ticket_id := md5(rec.id::text || ':seed_review:1')::uuid;
            INSERT INTO tickets (id, branch_id, service_id, source, public_number, status, queue_entered_at, called_at, served_at)
            VALUES (v_ticket_id, rec.id, v_service_id, 'QR', 'А-01', 'COMPLETED', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '175 minutes', NOW() - INTERVAL '165 minutes')
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO ticket_feedback (ticket_id, rating, comment, created_at)
            VALUES (v_ticket_id, 5, 'Отличное обслуживание, талон вызвали быстро. Оператор очень вежливый!', NOW() - INTERVAL '160 minutes')
            ON CONFLICT (ticket_id) DO NOTHING;

            -- 2. Отзыв 5 звезд
            v_ticket_id := md5(rec.id::text || ':seed_review:2')::uuid;
            INSERT INTO tickets (id, branch_id, service_id, source, public_number, status, queue_entered_at, called_at, served_at)
            VALUES (v_ticket_id, rec.id, v_service_id, 'APPOINTMENT', 'П-05', 'COMPLETED', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days')
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO ticket_feedback (ticket_id, rating, comment, created_at)
            VALUES (v_ticket_id, 5, 'Пришел по записи ко времени, сразу приняли без очереди. Очень удобно.', NOW() - INTERVAL '2 days')
            ON CONFLICT (ticket_id) DO NOTHING;

            -- 3. Отзыв 4 звезды
            v_ticket_id := md5(rec.id::text || ':seed_review:3')::uuid;
            INSERT INTO tickets (id, branch_id, service_id, source, public_number, status, queue_entered_at, called_at, served_at)
            VALUES (v_ticket_id, rec.id, v_service_id, 'LIVE', 'Б-12', 'COMPLETED', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days', NOW() - INTERVAL '5 days')
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO ticket_feedback (ticket_id, rating, comment, created_at)
            VALUES (v_ticket_id, 4, 'Удобное расположение и просторный зал. Быстро выдали посылку.', NOW() - INTERVAL '5 days')
            ON CONFLICT (ticket_id) DO NOTHING;
        END LOOP;
    END IF;
END $$;

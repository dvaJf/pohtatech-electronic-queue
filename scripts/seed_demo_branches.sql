-- Explicit opt-in demo catalog. Does not modify existing branches, tickets or operators.
-- Run after migration 000020 with psql -v ON_ERROR_STOP=1 -f scripts/seed_demo_branches.sql.
BEGIN;
CREATE TEMP TABLE demo_catalog (id uuid, name text, address text, work_hours text, latitude double precision, longitude double precision) ON COMMIT DROP;
INSERT INTO demo_catalog VALUES
('9e364b61-0543-5502-b048-50b2e65879a3','Главпочтамт Мясницкая','г. Москва, ул. Мясницкая, д. 26А, стр. 1','08:00–22:00',55.761845,37.638521),
('026ebdba-5e1a-51b9-9c9e-ae30c983f80f','Отделение Рождественка','г. Москва, Варсонофьевский пер., д. 4, стр. 1','08:00–20:00',55.76148,37.62512),
('186485b9-1dc5-53ce-b995-3f5be7f11958','Отделение Покровка','г. Москва, ул. Покровка, д. 4, стр. 1','08:00–20:00',55.75892,37.64415),
('cf56c7fd-5f3f-5c50-89dd-7d04c7c3e3db','Отделение Никольская','г. Москва, Никольская ул., д. 7-9, стр. 4','08:00–20:00',55.75691,37.62241),
('2356a4dc-a2ae-5c69-9182-cb399a9f8cdf','Отделение Тверская','г. Москва, Тверская ул., д. 9, стр. 5','08:00–21:00',55.75912,37.61195),
('2524a320-76ed-5bb9-81e2-3973255b17c2','Отделение Новый Арбат','г. Москва, Никитский бул., д. 5','08:00–20:00',55.75231,37.59842),
('cbad4e36-b4ea-5c86-8558-06ea6b962c81','Отделение Земляной Вал','г. Москва, ул. Земляной Вал, д. 2','08:00–20:00',55.75812,37.65912),
('990ccb1e-f7ad-57a1-ac0e-35f37c7dbd68','Отделение Большая Татарская','г. Москва, Озерковский пер., д. 13/19','08:00–20:00',55.73912,37.63345),
('626be556-c276-5388-abec-fb33daec48b6','Отделение Комсомольский просп.','г. Москва, Комсомольский просп., д. 31','08:00–20:00',55.72589,37.57945),
('24efc3d7-bfdb-5003-8e58-a0f48f6cd304','Отделение Садовая-Кудринская','г. Москва, ул. Спиридоновка, д. 27/24','08:00–20:00',55.76245,37.5879),
('0a03a444-c0d7-5809-a08e-20db6e65563d','Отделение Цветной бульвар','г. Москва, Цветной бул., д. 21, стр. 1','08:00–21:00',55.77012,37.62085),
('5f162202-c274-50b9-85e9-3788ed4f3f95','Отделение Проспект Мира','г. Москва, Проспект Мира, д. 51, стр. 1','08:00–20:00',55.78654,37.63412),
('b4192115-1ef6-52ba-9881-2933c87f168b','Отделение Авиамоторная','г. Москва, шоссе Энтузиастов, д. 22/18','08:00–20:00',55.75123,37.71654),
('16358aa5-e4bb-5387-89de-1bcc202d4c98','Отделение Бауманская','г. Москва, Бауманская ул., д. 38, стр. 2','08:00–20:00',55.77089,37.67845),
('7414c157-f8ca-5467-8b0f-6f36d2cf8710','Отделение Валовая','г. Москва, Дубининская ул., д. 11, стр. 2','08:00–20:00',55.73012,37.63214),
('ddf268b7-e190-53b8-83ec-66adb54a601f','Отделение Профсоюзная','г. Москва, ул. Кржижановского, д. 5, корп. 1','08:00–20:00',55.67912,37.57234),
('f62dc368-e38a-5d6c-bb74-aa077cd0f8a4','Отделение Поварская','г. Москва, ул. Поварская, д. 29/36, стр. 1','08:00–20:00',55.75612,37.58912),
('4e03ec9b-2d1b-5b89-95ab-84d01f87d21f','Отделение 1-я Тверская-Ямская','г. Москва, 1-я Тверская-Ямская ул., д. 6','08:00–21:00',55.77456,37.59345),
('d18de856-8aaf-55f9-8e2b-54c69879af10','Отделение Комсомольская пл.','г. Москва, Краснопрудная ул., д. 7-9','08:00–22:00',55.77589,37.65512),
('c185aa29-b409-5ad5-ad0e-04f9311976d3','Отделение Ленинский просп.','г. Москва, Ленинский просп., д. 25','08:00–20:00',55.71987,37.59234),
('20d686b9-c5b3-5548-aaab-50278bbddc82','Отделение Новослободская','г. Москва, Новослободская ул., д. 49/2','08:00–20:00',55.78234,37.59876),
('078d52e0-2ed8-56fc-9ee2-2fb0e5b4fa5c','Отделение Стромынка','г. Москва, ул. Стромынка, д. 20А','08:00–20:00',55.79345,37.69234),
('75efa8f7-be2a-5bb1-8d33-68d238776e9b','Отделение Автозаводская','г. Москва, Автозаводская ул., д. 5','08:00–20:00',55.70765,37.65345),
('e26cb8b2-c09c-5f21-b64d-a5359f1aa2c8','Отделение Шмитовский проезд','г. Москва, ул. Сергея Макеева, д. 2, стр. 1','08:00–20:00',55.75876,37.54987),
('5c791b5b-23ed-516e-800c-196f6de29ed9','Главпочтамт г. Рязань','г. Рязань, ул. Почтовая, д. 49','08:00–22:00',54.62912,39.73685),
('b1e06492-3c4a-5812-9c1a-2895f32a0001','Отделение Рязань Грибоедова','г. Рязань, ул. Грибоедова, д. 3','08:00–20:00',54.62745,39.75892),
('b1e06492-3c4a-5812-9c1a-2895f32a0002','Отделение Первомайский просп.','г. Рязань, Первомайский просп., д. 45','08:00–20:00',54.63051,39.71234),
('b1e06492-3c4a-5812-9c1a-2895f32a0003','Отделение Рязань Ленина','г. Рязань, ул. Почтовая, д. 49','08:00–20:00',54.62512,39.74312),
('b1e06492-3c4a-5812-9c1a-2895f32a0004','Отделение Островского','г. Рязань, ул. Ленинского Комсомола, д. 107','08:00–20:00',54.61845,39.70456),
('b1e06492-3c4a-5812-9c1a-2895f32a0005','Отделение Московское шоссе','г. Рязань, ул. Крупской, д. 19','08:00–20:00',54.64321,39.67543),
('b1e06492-3c4a-5812-9c1a-2895f32a0006','Отделение Маяковского','г. Рязань, Театральная площадь, д. 2','08:00–20:00',54.62314,39.74891),
('c1a06492-4d5b-6923-0d2b-3906a43b0001','Главпочтамт г. Казань','г. Казань, ул. Кремлёвская, д. 8','08:00–22:00',55.79512,49.11234),
('c1a06492-4d5b-6923-0d2b-3906a43b0002','Отделение Казань Баумана','г. Казань, ул. Баумана, д. 29','08:00–20:00',55.79045,49.11789),
('c1a06492-4d5b-6923-0d2b-3906a43b0003','Отделение Карла Маркса','г. Казань, ул. Карла Маркса, д. 44','08:00–20:00',55.79782,49.13567),
('c1a06492-4d5b-6923-0d2b-3906a43b0004','Отделение Татарстан','г. Казань, ул. Татарстан, д. 11','08:00–20:00',55.78123,49.11892),
('c1a06492-4d5b-6923-0d2b-3906a43b0005','Отделение Вишневского','г. Казань, ул. Вишневского, д. 14','08:00–20:00',55.78456,49.15234),
('c1a06492-4d5b-6923-0d2b-3906a43b0006','Отделение Николая Ершова','г. Казань, ул. Николая Ершова, д. 28','08:00–20:00',55.79345,49.16452),
('c1a06492-4d5b-6923-0d2b-3906a43b0007','Отделение Петербургская','г. Казань, ул. Хади Такташа, д. 75','08:00–20:00',55.78234,49.13125),
('c1a06492-4d5b-6923-0d2b-3906a43b0008','Отделение Чистопольская','г. Казань, Чистопольская ул., д. 23','08:00–20:00',55.82145,49.11345);
INSERT INTO branches(id,name,address,work_hours,timezone_offset,latitude,longitude,is_demo)
SELECT id,name,address,work_hours,3,latitude,longitude,false FROM demo_catalog
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    address = EXCLUDED.address,
    work_hours = EXCLUDED.work_hours,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude;
INSERT INTO branch_services(branch_id,service_id)
SELECT d.id,s.id FROM demo_catalog d CROSS JOIN services s
ON CONFLICT DO NOTHING;
INSERT INTO windows(id,branch_id,number,status)
SELECT md5(d.id::text || ':window:' || n)::uuid,d.id,n,'OPEN'
FROM demo_catalog d CROSS JOIN generate_series(1,3) n
ON CONFLICT DO NOTHING;
INSERT INTO window_services(window_id,branch_id,service_id)
SELECT w.id,w.branch_id,bs.service_id FROM windows w
JOIN demo_catalog d ON d.id=w.branch_id JOIN branch_services bs ON bs.branch_id=w.branch_id
ON CONFLICT DO NOTHING;
INSERT INTO queue_policies(branch_id,appointment_due_priority,qr_priority,version)
SELECT id,100,10,1 FROM demo_catalog ON CONFLICT DO NOTHING;

-- Seed authentic feedback
DO $$
DECLARE
    rec RECORD;
    v_ticket_id uuid;
    v_service_id uuid;
BEGIN
    SELECT id INTO v_service_id FROM services LIMIT 1;
    IF v_service_id IS NOT NULL THEN
        FOR rec IN SELECT id, name FROM demo_catalog WHERE id NOT IN ('9e364b61-0543-5502-b048-50b2e65879a3') LOOP
            v_ticket_id := md5(rec.id::text || ':seed_feedback:1')::uuid;
            INSERT INTO tickets (id, branch_id, service_id, source, public_number, status, queue_entered_at, called_at, served_at)
            VALUES (v_ticket_id, rec.id, v_service_id, 'QR', 'А-01', 'COMPLETED', NOW() - INTERVAL '4 hours', NOW() - INTERVAL '235 minutes', NOW() - INTERVAL '225 minutes')
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO ticket_feedback (ticket_id, rating, comment, created_at)
            VALUES (v_ticket_id, 5, 'Отличное обслуживание, оператор помог быстро оформить отправку.', NOW() - INTERVAL '220 minutes')
            ON CONFLICT (ticket_id) DO NOTHING;

            v_ticket_id := md5(rec.id::text || ':seed_feedback:2')::uuid;
            INSERT INTO tickets (id, branch_id, service_id, source, public_number, status, queue_entered_at, called_at, served_at)
            VALUES (v_ticket_id, rec.id, v_service_id, 'APPOINTMENT', 'П-03', 'COMPLETED', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')
            ON CONFLICT (id) DO NOTHING;

            INSERT INTO ticket_feedback (ticket_id, rating, comment, created_at)
            VALUES (v_ticket_id, 5, 'Записался на сайте, пришел и сразу подошел к окну. Никаких очередей.', NOW() - INTERVAL '1 day')
            ON CONFLICT (ticket_id) DO NOTHING;
        END LOOP;
    END IF;
END $$;
COMMIT;


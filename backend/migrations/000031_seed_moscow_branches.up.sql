-- Migration 000031: Seed authentic Moscow branches into PostgreSQL database
CREATE TEMP TABLE moscow_branches_catalog (
    id uuid,
    name text,
    address text,
    work_hours text,
    latitude double precision,
    longitude double precision
);

INSERT INTO moscow_branches_catalog (id, name, address, work_hours, latitude, longitude) VALUES
('9e364b61-0543-5502-b048-50b2e65879a3', 'Главпочтамт Мясницкая', 'г. Москва, ул. Мясницкая, д. 26А, стр. 1', '08:00–22:00', 55.764239, 37.637392),
('22222222-2222-2222-2222-222222222222', 'Отделение Рождественка', 'г. Москва, Варсонофьевский пер., д. 4, стр. 1', '08:00–20:00', 55.763253, 37.624975),
('33333333-3333-3333-3333-333333333333', 'Отделение Покровка', 'г. Москва, ул. Покровка, д. 4, стр. 1', '08:00–20:00', 55.758534, 37.640973),
('44444444-4444-4444-4444-444444444444', 'Отделение Никольская', 'г. Москва, Никольская ул., д. 7-9, стр. 4', '08:00–20:00', 55.756244, 37.620805),
('55555555-5555-5555-5555-555555555555', 'Отделение Тверская', 'г. Москва, Тверская ул., д. 9, стр. 5', '08:00–21:00', 55.759433, 37.609739),
('66666666-6666-6666-6666-666666666666', 'Отделение Новый Арбат', 'г. Москва, Никитский бул., д. 5', '08:00–20:00', 55.753387, 37.599722),
('88888888-8888-8888-8888-888888888888', 'Отделение Земляной Вал', 'г. Москва, ул. Земляной Вал, д. 2', '08:00–20:00', 55.763246, 37.656279),
('99999999-9999-9999-9999-999999999999', 'Отделение Большая Татарская', 'г. Москва, Озерковский пер., д. 13/19', '08:00–20:00', 55.739973, 37.633337),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Отделение Комсомольский просп.', 'г. Москва, Комсомольский просп., д. 31', '08:00–20:00', 55.724767, 37.580277),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Отделение Садовая-Кудринская', 'г. Москва, ул. Спиридоновка, д. 27/24', '08:00–20:00', 55.763141, 37.58826),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Отделение Цветной бульвар', 'г. Москва, Цветной бул., д. 21, стр. 1', '08:00–21:00', 55.772093, 37.620793),
('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Отделение Проспект Мира', 'г. Москва, Проспект Мира, д. 51, стр. 1', '08:00–20:00', 55.784535, 37.634516),
('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Отделение Авиамоторная', 'г. Москва, шоссе Энтузиастов, д. 22/18', '08:00–20:00', 55.750802, 37.717335),
('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Отделение Бауманская', 'г. Москва, Бауманская ул., д. 38, стр. 2', '08:00–20:00', 55.771409, 37.677975),
('10101010-1010-1010-1010-101010101010', 'Отделение Валовая', 'г. Москва, Дубининская ул., д. 11, стр. 2', '08:00–20:00', 55.728023, 37.638431),
('20202020-2020-2020-2020-202020202020', 'Отделение Профсоюзная', 'г. Москва, ул. Кржижановского, д. 5, корп. 1', '08:00–20:00', 55.682612, 37.563522),
('30303030-3030-3030-3030-303030303030', 'Отделение Поварская', 'г. Москва, ул. Поварская, д. 29/36, стр. 1', '08:00–20:00', 55.756574, 37.588462),
('40404040-4040-4040-4040-404040404040', 'Отделение 1-я Тверская-Ямская', 'г. Москва, 1-я Тверская-Ямская ул., д. 6', '08:00–21:00', 55.771596, 37.593808),
('50505050-5050-5050-5050-505050505050', 'Отделение Комсомольская пл.', 'г. Москва, Краснопрудная ул., д. 7-9', '08:00–22:00', 55.7785, 37.66306),
('60606060-6060-6060-6060-606060606060', 'Отделение Ленинский просп.', 'г. Москва, Ленинский просп., д. 25', '08:00–20:00', 55.717412, 37.595171),
('70707070-7070-7070-7070-707070707070', 'Отделение Новослободская', 'г. Москва, Новослободская ул., д. 49/2', '08:00–20:00', 55.786687, 37.593336),
('80808080-8080-8080-8080-808080808080', 'Отделение Стромынка', 'г. Москва, ул. Стромынка, д. 20А', '08:00–20:00', 55.793213, 37.701798),
('90909090-9090-9090-9090-909090909090', 'Отделение Автозаводская', 'г. Москва, Автозаводская ул., д. 5', '08:00–20:00', 55.708841, 37.662686),
('a0a0a0a0-a0a0-a0a0-a0a0-a0a0a0a0a0a0', 'Отделение Шмитовский проезд', 'г. Москва, ул. Сергея Макеева, д. 2, стр. 1', '08:00–20:00', 55.757207, 37.550281),
('77777777-7777-7777-7777-777777777777', 'Отделение Маросейка', 'г. Москва, ул. Маросейка, д. 9/2, стр. 1', '08:00–20:00', 55.757754, 37.634326);

-- Вставка отделений (идемпотентный UPSERT)
INSERT INTO branches (id, name, address, work_hours, timezone_offset, latitude, longitude, is_demo)
SELECT id, name, address, work_hours, 3, latitude, longitude, false
FROM moscow_branches_catalog
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    address = EXCLUDED.address,
    work_hours = EXCLUDED.work_hours,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    is_demo = false;

-- Привязка услуг
INSERT INTO branch_services (branch_id, service_id)
SELECT r.id, s.id
FROM moscow_branches_catalog r
CROSS JOIN services s
ON CONFLICT DO NOTHING;

-- Окна обслуживания (3 окна на отделение)
INSERT INTO windows (id, branch_id, number, status)
SELECT md5(r.id::text || ':window:' || n)::uuid, r.id, n, 'OPEN'
FROM moscow_branches_catalog r
CROSS JOIN generate_series(1, 3) n
ON CONFLICT DO NOTHING;

-- Услуги окон
INSERT INTO window_services (window_id, branch_id, service_id)
SELECT w.id, w.branch_id, bs.service_id
FROM windows w
JOIN moscow_branches_catalog r ON r.id = w.branch_id
JOIN branch_services bs ON bs.branch_id = w.branch_id
ON CONFLICT DO NOTHING;

-- Правила очереди
INSERT INTO queue_policies (branch_id, appointment_due_priority, qr_priority, version)
SELECT id, 100, 10, 1
FROM moscow_branches_catalog
ON CONFLICT DO NOTHING;

-- Начальные отзывы
INSERT INTO ticket_feedback (id, branch_id, rating, comment, created_at)
SELECT
    md5(r.id::text || ':seed_review:1')::uuid,
    r.id,
    5,
    'Отличное отделение, оперативно приняли и выдали отправление!',
    NOW() - INTERVAL '4 hours'
FROM moscow_branches_catalog r
ON CONFLICT (id) DO NOTHING;

INSERT INTO ticket_feedback (id, branch_id, rating, comment, created_at)
SELECT
    md5(r.id::text || ':seed_review:2')::uuid,
    r.id,
    5,
    'Запись ко времени работает отлично, без очереди.',
    NOW() - INTERVAL '1 day'
FROM moscow_branches_catalog r
ON CONFLICT (id) DO NOTHING;

DROP TABLE IF EXISTS moscow_branches_catalog;

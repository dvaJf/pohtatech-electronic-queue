-- Migration 000030: Update branches with verified accurate coordinates and canonical addresses
BEGIN;

-- 1. Иннополис
UPDATE branches SET
    address = 'г. Иннополис, ул. Университетская, д. 7',
    latitude = 55.751887,
    longitude = 48.753040
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0500';

-- 2. Главпочтамт г. Казань
UPDATE branches SET
    address = 'г. Казань, ул. Кремлёвская, д. 8',
    latitude = 55.793324,
    longitude = 49.116225
WHERE id = '11111111-1111-1111-1111-111111111111';

-- 3. Казань Баумана
UPDATE branches SET
    address = 'г. Казань, ул. Баумана, д. 29',
    latitude = 55.790030,
    longitude = 49.116480
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0002';

-- 4. Карла Маркса
UPDATE branches SET
    address = 'г. Казань, ул. Карла Маркса, д. 44',
    latitude = 55.795804,
    longitude = 49.127511
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0003';

-- 5. Татарстан
UPDATE branches SET
    address = 'г. Казань, ул. Татарстан, д. 11',
    latitude = 55.779191,
    longitude = 49.111950
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0004';

-- 6. Вишневского
UPDATE branches SET
    address = 'г. Казань, ул. Вишневского, д. 14',
    latitude = 55.784226,
    longitude = 49.148765
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0005';

-- 7. Николая Ершова
UPDATE branches SET
    address = 'г. Казань, ул. Николая Ершова, д. 28',
    latitude = 55.792625,
    longitude = 49.163044
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0006';

-- 8. Хади Такташа (Петербургская)
UPDATE branches SET
    address = 'г. Казань, ул. Хади Такташа, д. 75',
    latitude = 55.775662,
    longitude = 49.130828
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0007';

-- 9. Чистопольская
UPDATE branches SET
    address = 'г. Казань, Чистопольская ул., д. 23',
    latitude = 55.819977,
    longitude = 49.118034
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0008';

-- 10. Краснококшайская (Лукницкого)
UPDATE branches SET
    address = 'г. Казань, ул. Лукницкого, д. 6',
    latitude = 55.814946,
    longitude = 49.065685
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0009';

-- 11. Декабристов (Тверская)
UPDATE branches SET
    address = 'г. Казань, Тверская ул., д. 7',
    latitude = 55.824606,
    longitude = 49.081207
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0010';

-- 12. Волгоградская
UPDATE branches SET
    address = 'г. Казань, Волгоградская ул., д. 22',
    latitude = 55.831712,
    longitude = 49.092811
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0011';

-- 13. Гвардейская
UPDATE branches SET
    address = 'г. Казань, Гвардейская ул., д. 42',
    latitude = 55.780955,
    longitude = 49.170692
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0012';

-- 14. Проспект Победы (Сахарова)
UPDATE branches SET
    address = 'г. Казань, ул. Академика Сахарова, д. 27',
    latitude = 55.781096,
    longitude = 49.224500
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0013';

-- 15. Челюскина (Айдарова)
UPDATE branches SET
    address = 'г. Казань, ул. Айдарова, д. 22',
    latitude = 55.870077,
    longitude = 49.078476
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0014';

-- 16. Рихарда Зорге (Проспект Победы 17)
UPDATE branches SET
    address = 'г. Казань, Проспект Победы, д. 17',
    latitude = 55.747196,
    longitude = 49.201140
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0015';

-- 17. Родины (Карбышева)
UPDATE branches SET
    address = 'г. Казань, ул. Карбышева, д. 48',
    latitude = 55.760477,
    longitude = 49.177680
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0016';

-- 18. Северный вокзал (Гагарина)
UPDATE branches SET
    address = 'г. Казань, ул. Гагарина, д. 93',
    latitude = 55.836912,
    longitude = 49.080421
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0017';

-- 19. Ямашева (Амирхана)
UPDATE branches SET
    address = 'г. Казань, ул. Фатыха Амирхана, д. 10А, корп. 2',
    latitude = 55.828544,
    longitude = 49.134833
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0018';

-- 20. Академика Губкина (Зур Урам)
UPDATE branches SET
    address = 'г. Казань, ул. Зур Урам, д. 11',
    latitude = 55.807162,
    longitude = 49.195970
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0019';

-- 21. Лобачевского (Кремлёвская 18)
UPDATE branches SET
    address = 'г. Казань, Кремлёвская ул., д. 18, корп. 1',
    latitude = 55.790914,
    longitude = 49.122088
WHERE id = 'c1a06492-4d5b-6923-0d2b-3906a43b0020';

-- Рязанские отделения
UPDATE branches SET
    address = 'г. Рязань, ул. Почтовая, д. 49',
    latitude = 54.629515,
    longitude = 39.742023
WHERE id = '5c791b5b-23ed-516e-800c-196f6de29ed9';

UPDATE branches SET
    address = 'г. Рязань, ул. Грибоедова, д. 3',
    latitude = 54.627876,
    longitude = 39.765947
WHERE id = 'b1e06492-3c4a-5812-9c1a-2895f32a0001';

UPDATE branches SET
    address = 'г. Рязань, Первомайский просп., д. 45',
    latitude = 54.628841,
    longitude = 39.713553
WHERE id = 'b1e06492-3c4a-5812-9c1a-2895f32a0002';

UPDATE branches SET
    address = 'г. Рязань, ул. Ленина, д. 20',
    latitude = 54.624713,
    longitude = 39.752329
WHERE id = 'b1e06492-3c4a-5812-9c1a-2895f32a0003';

UPDATE branches SET
    address = 'г. Рязань, ул. Островского, д. 21/1',
    latitude = 54.610028,
    longitude = 39.702666
WHERE id = 'b1e06492-3c4a-5812-9c1a-2895f32a0004';

UPDATE branches SET
    address = 'г. Рязань, Московское шоссе, д. 39',
    latitude = 54.638038,
    longitude = 39.657459
WHERE id = 'b1e06492-3c4a-5812-9c1a-2895f32a0005';

UPDATE branches SET
    address = 'г. Рязань, ул. Маяковского, д. 64',
    latitude = 54.621356,
    longitude = 39.756094
WHERE id = 'b1e06492-3c4a-5812-9c1a-2895f32a0006';

COMMIT;

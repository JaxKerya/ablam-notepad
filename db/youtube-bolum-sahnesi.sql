-- Ablam YouTube: bölüme özel sahne.
-- youtube_sahneler.bolum_id: dolu = sahne o bölümün konusundan otomatik üretildi (config [sahne] bolume_ozel).
-- Bölüm silinirse sahne kalır (genel sahne gibi elle kullanılabilir).
alter table youtube_sahneler add column if not exists bolum_id uuid references youtube_bolumler(id) on delete set null;

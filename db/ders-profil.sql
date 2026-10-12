-- Ablam Ders: iki profil (ablam, ozi) — dersler ortak, cevaplar kişiye özel
-- 12.10.2026. İKİ ADIM; sıra önemli:
--
--   1. ADIM — push'tan ÖNCE çalıştır. Yalnızca ekleme yapıyor; şu anki site
--      (profil bilmeyen kod) aynen çalışmaya devam eder. Mevcut bütün cevaplar
--      ve pratik/deneme/yanlış oturumları "ablam"a yazılır.
--   2. ADIM — push yayına girdikten SONRA çalıştır. "Her soruya tek cevap"
--      kısıtını kaldırır; bundan sonra aynı soruya iki profil ayrı cevap verir.
--      2. adımdan önce çalıştırılırsa ESKİ kod cevap kaydedemez (onConflict
--      question_id o kısıta dayanıyor).
--
-- Her iki adım da tekrar çalıştırılabilir.

-- ============================================================ 1. ADIM
alter table ders_answers add column if not exists profil text not null default 'ablam';
-- Dersler (tur 'ders', 'arsiv') ortak, profil null; kişisel oturumlar profilli
alter table ders_sessions add column if not exists profil text;
update ders_sessions set profil = 'ablam'
  where tur in ('tekrar', 'deneme', 'yanlis', 'test') and profil is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ders_answers_soru_profil_key') then
    alter table ders_answers add constraint ders_answers_soru_profil_key unique (question_id, profil);
  end if;
end $$;

create index if not exists ders_answers_profil_idx on ders_answers (profil);
create index if not exists ders_sessions_profil_idx on ders_sessions (profil);


-- ============================================================ 2. ADIM
-- (push yayına girdikten sonra, ayrıca çalıştır)
-- alter table ders_answers drop constraint if exists ders_answers_question_id_key;

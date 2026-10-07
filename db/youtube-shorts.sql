-- Ablam YouTube: Shorts tanıtım fragmanı. Uzun bölüm yayına girince stüdyo bölümün kendi anlatımından kısa bir
-- dikey fragman üretir (gece/fragman.py); sitede izlenip onaylanınca Shorts olarak planlı yüklenir.
-- shorts_durum: null | bekliyor | uretiliyor | onay | yayinla | yayinda | hata
alter table youtube_bolumler add column if not exists shorts_durum text;
alter table youtube_bolumler add column if not exists shorts_url text;
alter table youtube_bolumler add column if not exists shorts_baslik text;
alter table youtube_bolumler add column if not exists shorts_youtube_id text;
alter table youtube_bolumler add column if not exists shorts_yayin_zamani timestamptz;
alter table youtube_bolumler add column if not exists shorts_hata text;

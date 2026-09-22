-- Ablam YouTube — küçük resim (2026-09-21). Bir kez çalıştırın.
-- Ablam sitede isteğe bağlı bir küçük resim yükler (Storage: youtube/thumbnail/<id>.jpg);
-- stüdyo yayından sonra YouTube'a gönderir.
alter table youtube_bolumler add column if not exists thumbnail_url text;
-- "Seri" kavramı kaldırıldı: youtube_seriler artık yalnızca arka plan SAHNESİ demek.
-- Tablo adı uyumluluk için duruyor; arayüz "Sahne" der.

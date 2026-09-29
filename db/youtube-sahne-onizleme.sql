-- Ablam YouTube: sahne (loop) önizlemesi — stüdyo 3 tur oynayan 720p küçük bir mp4 yükler.
--
-- SIRA UYARISI: bu kolon SAHNEye aittir. Dosya youtube-seriler.sql'den (sahne/seri
-- ayrımı) önce yazıldı; o tarihte "youtube_seriler" sahne demekti. Ayrım yapıldıktan
-- sonra çalıştırılırsa kolon yanlış tabloya (içerik serisine) giderdi — aşağıdaki blok
-- hangi tablonun var olduğuna bakıp doğrusunu seçiyor, sıradan bağımsız çalışır.
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'youtube_sahneler') then
    alter table youtube_sahneler add column if not exists onizleme_url text;
  else
    alter table youtube_seriler add column if not exists onizleme_url text;
  end if;
end $$;

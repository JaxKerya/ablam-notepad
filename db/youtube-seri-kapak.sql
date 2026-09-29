-- Ablam YouTube: seriye özel kapak stili.
-- Doluysa o serinin bütün kapakları aynı teknik ve paletle çıkar (seri kimliği);
-- boşsa stil konunun döneminden seçilir (eski davranış).
--
-- SIRA UYARISI: buradaki "youtube_seriler" İÇERİK SERİSİ demek, sahne değil.
-- youtube-seriler.sql'den (sahne/seri ayrımı) SONRA çalıştırılmalı; önce
-- çalıştırılırsa kolon sahne tablosuna gider. Aşağıdaki kontrol bunu engelliyor.
do $$
begin
  if not exists (select 1 from information_schema.tables where table_name = 'youtube_sahneler') then
    raise exception 'Önce db/youtube-seriler.sql çalıştırılmalı (sahne/seri ayrımı yapılmadan bu dosya kolonu yanlış tabloya koyar).';
  end if;
end $$;

alter table youtube_seriler add column if not exists kapak_stil text;

update youtube_seriler set kapak_stil =
  'Antique black-figure print: solid black silhouettes on a warm amber-ochre clay background, fine cream engraved line details incised inside the black shapes, aged paper and clay patina texture. Palette strictly amber-ochre, black and cream.'
where ad = 'Merak' and kapak_stil is null;

update youtube_seriler set kapak_stil =
  'Late 19th-century poster lithograph: flat inked shapes with visible print grain on aged cream paper, deep midnight navy background, warm lamp-amber light sources and muted brass accents, thin engraved hatching for texture. Palette strictly midnight navy, lamp amber, brass and cream.'
where ad = 'Bir Gece Orada Olsaydın' and kapak_stil is null;

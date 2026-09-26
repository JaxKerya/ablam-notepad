-- Ablam YouTube: büyüme ve kalite paketi.
-- youtube_seriler.derleme       : true = bu seri yeni senaryo yazmaz; yayındaki bölümleri tek uzun videoda birleştirir.
-- youtube_bolumler.derleme_idler: derleme bölümünde arka arkaya eklenecek bölümler (sırasıyla).
-- youtube_bolumler.kalite       : yüklemeden önceki teknik kontrol raporu {sonuc, zaman, kontroller[]}.
-- youtube_bolumler.istatistik   : YouTube istatistikleri (izlenme, izlenme süresi, gösterim, tıklanma oranı…).
alter table youtube_seriler add column if not exists derleme boolean not null default false;
alter table youtube_bolumler add column if not exists derleme_idler uuid[] not null default '{}';
alter table youtube_bolumler add column if not exists kalite jsonb;
alter table youtube_bolumler add column if not exists istatistik jsonb;
alter table youtube_bolumler add column if not exists istatistik_zaman timestamptz;

-- Derleme serisi (bir tane yeter). Sahne havuzu: her konuya uyan genel sahneler.
insert into youtube_seriler (ad, aciklama, kalip, sahne_id, sahne_idler, sure_dk, derleme)
select 'Gece Boyu Anlatımlar',
       'Kanaldaki anlatımlar arka arkaya, gece boyu kapatmadan dinlemek için: 3-4 saat, sonunda ortam sesi.',
       'deneyim', h[1], h, 180, true
from (select array_agg(id order by created_at) as h from youtube_sahneler
      where ad in ('Taş Ev', 'Çatı Katı', 'Göl Kulübesi', 'Kır Evi Mutfağı', 'Yağmur Ormanları', 'Kütüphane')) s
where not exists (select 1 from youtube_seriler where derleme);

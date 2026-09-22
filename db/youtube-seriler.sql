-- Ablam YouTube — gerçek "seri" kavramı.
--
-- Eskiden `youtube_seriler` aslında SAHNE demekti (arkada dönen loop görsel).
-- Artık iki ayrı şey var:
--   youtube_sahneler : loop görsel (eski youtube_seriler, yeniden adlandırıldı)
--   youtube_seriler  : içerik serisi — konu evreni + senaryo kalıbı + sahne + varsayılan süre
--
-- Bölüm bir seriye aittir; sahnesini serisinden alır (bölümde de tutulur ki
-- sonradan seri değişse bile üretilmiş videonun hangi sahneyle çıktığı bilinsin).
-- Bu dosyayı bir kez çalıştırmak yeterli; tekrar çalıştırmak güvenlidir.

-- ---------------------------------------------------------------------------
-- 1) Eski tabloyu sahne olarak yeniden adlandır
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'youtube_seriler')
     and not exists (select 1 from information_schema.tables where table_name = 'youtube_sahneler') then
    alter table youtube_seriler rename to youtube_sahneler;
    alter table youtube_bolumler rename column seri_id to sahne_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Yeni seri tablosu
--    kalip: senaryo ve başlık üslubunu belirler
--      'aciklayici' → soru odaklı öğretici ("Bal neden bozulmaz?")
--      'deneyim'    → bir mekânda bir gece, ikinci şahıs ("Kervansarayda 1 gecen")
-- ---------------------------------------------------------------------------
create table if not exists youtube_seriler (
  id          uuid primary key default gen_random_uuid(),
  ad          text not null,
  aciklama    text,                                   -- serinin konu evreni, bir iki cümle
  kalip       text not null default 'aciklayici',     -- aciklayici | deneyim
  sahne_id    uuid references youtube_sahneler(id),   -- bu serinin bölümlerinde dönen görsel
  sure_dk     integer not null default 60 check (sure_dk between 10 and 180),
  oynatma_listesi text,                               -- YouTube playlist id (ileride otomatik)
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table youtube_bolumler add column if not exists seri_id uuid references youtube_seriler(id);

-- ---------------------------------------------------------------------------
-- 3) İlk iki seri + mevcut bölümlerin devri
--    Sahneler: "Yağmurlu Kulübe" açıklayıcı seriye, "Eski Kütüphane" deneyim serisine.
-- ---------------------------------------------------------------------------
insert into youtube_seriler (ad, aciklama, kalip, sahne_id, sure_dk)
select 'Merak', 'Gündelik olguların perde arkası: bal neden bozulmaz, fiyortlar neden donmaz. Soru sorar, adım adım cevaplar.',
       'aciklayici', (select id from youtube_sahneler where ad = 'Yağmurlu Kulübe' limit 1), 60
where not exists (select 1 from youtube_seriler where ad = 'Merak');

insert into youtube_seriler (ad, aciklama, kalip, sahne_id, sure_dk)
select 'Bir Gece Orada Olsaydın', 'Belirli bir mekânda, belirli bir işte geçen tek bir gece: kervansaray, deniz feneri, gar, kervan. Saat saat ilerler.',
       'deneyim', (select id from youtube_sahneler where ad = 'Eski Kütüphane' limit 1), 105
where not exists (select 1 from youtube_seriler where ad = 'Bir Gece Orada Olsaydın');

-- Serisi olmayan eski bölümler "Merak" serisine bağlanır (sahneleri kendilerinde duruyor).
update youtube_bolumler set seri_id = (select id from youtube_seriler where ad = 'Merak' limit 1)
where seri_id is null;

-- ---------------------------------------------------------------------------
-- 4) RLS + realtime + updated_at — diğer tablolarla aynı desen
-- ---------------------------------------------------------------------------
alter table youtube_seriler enable row level security;
drop policy if exists "youtube_seriler_public_all" on youtube_seriler;
create policy "youtube_seriler_public_all" on youtube_seriler for all using (true) with check (true);

drop trigger if exists youtube_seriler_set_updated_at on youtube_seriler;
create trigger youtube_seriler_set_updated_at
  before update on youtube_seriler for each row execute function update_updated_at();

alter table youtube_seriler replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'youtube_seriler') then
    alter publication supabase_realtime add table youtube_seriler;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'youtube_sahneler') then
    alter publication supabase_realtime add table youtube_sahneler;
  end if;
end $$;

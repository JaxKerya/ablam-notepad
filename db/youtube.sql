-- Ablam YouTube — uzun formatlı uyku anlatımı bölümleri (UykuCast)
-- Supabase SQL Editor'da bu dosyanın tamamını çalıştırın. Yeniden çalıştırmak güvenlidir.
--
-- Mimari Kariyer ile aynı: site yalnızca bu tablolara yazar/okur; üretimi
-- evdeki bilgisayarda koşan "stüdyo" (gece/gece/worker.py) yapar. İkisi
-- birbirini görmez, sadece satırların durum kolonu üzerinden konuşurlar.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Seriler — kanalın alt dizileri ("Dünya Uyurken", "Yavaş Bilim"...). Her
-- serinin bir sahnesi var: bölümlerin arkasında dönen 8 saniyelik görsel.
-- Sahne bir kez üretilir (fal.ai), sonra o serinin her bölümünde tekrar döner.
-- ---------------------------------------------------------------------------
create table if not exists youtube_seriler (
  id          uuid primary key default gen_random_uuid(),
  ad          text not null,
  aciklama    text,                        -- serinin bir cümlelik tanımı (senaryoya tona girer)
  sahne       text not null,               -- görselin tarifi, Türkçe (stüdyo İngilizceye çevirir)
  loop_dosya  text,                        -- stüdyodaki dosya adı (loops/<slug>.mp4)
  loop_durum  text not null default 'bekliyor',  -- bekliyor | uretiliyor | hazir | hata
  kapak_url   text,                        -- sahnenin ilk karesi (Storage), listede görünür
  hata        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Bölümler — her satır bir video. durum kolonu iş akışının tamamı:
--
--   bekliyor      ablam konuyu yazdı, stüdyo henüz almadı
--   senaryo       senaryo yazılıyor (adim / ilerleme dolar)
--   senaryo_onay  senaryo hazır, ablam okuyup onaylayacak (senaryo_md düzenlenebilir)
--   onaylandi     ablam onayladı, stüdyo sesi ve videoyu üretecek
--   ses           seslendirme
--   render        video birleştiriliyor, önizleme yükleniyor
--   hazir         video bilgisayarda hazır, önizleme sitede; ablam "yükle" diyecek
--   yayinla       ablam yükle dedi, stüdyo YouTube'a gönderiyor
--   yayinda       YouTube'da (youtube_url dolu)
--   hata          bir adım düştü (hata kolonu); "tekrar dene" bekliyor'a döndürür
--
-- Senaryo veritabanında markdown olarak durur: "# başlık" + "## bölüm" + paragraflar.
-- Ablam sitede düzenler; stüdyo onaydan sonra bu metni okur, kendi dosyasını değil.
-- ---------------------------------------------------------------------------
create table if not exists youtube_bolumler (
  id            uuid primary key default gen_random_uuid(),
  seri_id       uuid not null references youtube_seriler(id) on delete restrict,
  konu          text not null,
  sure_dk       integer not null default 60 check (sure_dk between 10 and 180),
  durum         text not null default 'bekliyor',
  adim          text,                       -- "3/9 bölüm yazılıyor" gibi, ekranda görünür
  ilerleme      integer not null default 0 check (ilerleme between 0 and 100),
  baslik        text,
  senaryo_md    text,
  kelime        integer,
  sure_sn       numeric,                    -- üretilen sesin süresi
  bolumler      jsonb,                      -- [{title, start}] — açıklamadaki zaman damgaları
  yt_baslik     text,                       -- YouTube'a gidecek başlık/açıklama/etiketler (düzenlenebilir)
  yt_aciklama   text,
  yt_etiketler  text[] not null default '{}',
  gizlilik      text not null default 'unlisted',  -- unlisted | public | private
  onizleme_url  text,                       -- ilk 60 saniye, 720p (Storage)
  youtube_id    text,
  youtube_url   text,
  hata          text,
  gunluk        text[] not null default '{}',  -- stüdyonun kısa log satırları
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists youtube_bolumler_durum_idx   on youtube_bolumler (durum, created_at);
create index if not exists youtube_bolumler_created_idx on youtube_bolumler (created_at desc);

-- ---------------------------------------------------------------------------
-- Nabız — stüdyo çalışıyor mu? Tek satır; stüdyo her turda son_gorulme'yi
-- günceller. Site 3 dakikadan eskiyse "çevrimdışı" gösterir.
-- ---------------------------------------------------------------------------
create table if not exists youtube_nabiz (
  id           integer primary key default 1 check (id = 1),
  son_gorulme  timestamptz,
  mesaj        text,                        -- "boşta" | "kutup-gecesi: ses 40%"
  makine       text
);
insert into youtube_nabiz (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- updated_at tetikleyicileri (notes tablosundaki fonksiyon)
-- ---------------------------------------------------------------------------
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists youtube_seriler_set_updated_at on youtube_seriler;
create trigger youtube_seriler_set_updated_at
  before update on youtube_seriler for each row execute function update_updated_at();

drop trigger if exists youtube_bolumler_set_updated_at on youtube_bolumler;
create trigger youtube_bolumler_set_updated_at
  before update on youtube_bolumler for each row execute function update_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — site giriş kapısının arkasında, diğer tablolarla aynı desen
-- ---------------------------------------------------------------------------
alter table youtube_seriler  enable row level security;
alter table youtube_bolumler enable row level security;
alter table youtube_nabiz    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['youtube_seriler', 'youtube_bolumler', 'youtube_nabiz']
  loop
    execute format('drop policy if exists "%s_public_all" on %I', t, t);
    execute format(
      'create policy "%s_public_all" on %I for all using (true) with check (true)', t, t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Realtime — ilerleme çubuğu sayfa yenilemeden aksın
-- ---------------------------------------------------------------------------
alter table youtube_bolumler replica identity full;
alter table youtube_seriler  replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'youtube_bolumler') then
    alter publication supabase_realtime add table youtube_bolumler;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'youtube_seriler') then
    alter publication supabase_realtime add table youtube_seriler;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Storage — önizleme klipleri ve seri kapakları. Bucket herkese açık okunur;
-- yazan yalnızca stüdyo (anon anahtarla, aşağıdaki politika).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('youtube', 'youtube', true)
  on conflict (id) do nothing;

drop policy if exists "youtube_public_read"   on storage.objects;
drop policy if exists "youtube_public_write"  on storage.objects;
drop policy if exists "youtube_public_update" on storage.objects;
create policy "youtube_public_read"   on storage.objects for select using (bucket_id = 'youtube');
create policy "youtube_public_write"  on storage.objects for insert with check (bucket_id = 'youtube');
create policy "youtube_public_update" on storage.objects for update using (bucket_id = 'youtube');

-- Ablam YouTube: bölüm başına birden fazla Shorts fragmanı (config [shorts] adet, varsayılan 2).
-- youtube-shorts.sql bölüm satırına tek Shorts koymuştu; bu dosya her Shorts'u ayrı satıra taşır.
-- Bölüm satırındaki shorts_* sütunlarındaki kayıtlar 1. Shorts olarak buraya kopyalanır (sütunlar artık kullanılmaz).
-- durum: bekliyor | uretiliyor | onay | yayinla | yayinda | hata

create table if not exists youtube_shorts (
  id           uuid primary key default gen_random_uuid(),
  bolum_id     uuid not null references youtube_bolumler(id) on delete cascade,
  sira         int  not null default 1,
  durum        text not null default 'bekliyor',
  baslik       text,
  metin        text,
  url          text,
  youtube_id   text,
  yayin_zamani timestamptz,
  hata         text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (bolum_id, sira)
);

drop trigger if exists youtube_shorts_set_updated_at on youtube_shorts;
create trigger youtube_shorts_set_updated_at
  before update on youtube_shorts for each row execute function update_updated_at();

alter table youtube_shorts enable row level security;
drop policy if exists "youtube_shorts_public_all" on youtube_shorts;
create policy "youtube_shorts_public_all" on youtube_shorts for all using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'youtube_shorts') then
    alter publication supabase_realtime add table youtube_shorts;
  end if;
end $$;

-- Mevcut tek-Shorts kayıtlarını 1. Shorts olarak taşı (yarıda kalan üretim baştan alınır)
insert into youtube_shorts (bolum_id, sira, durum, baslik, url, youtube_id, yayin_zamani, hata)
select id, 1,
       case when shorts_durum = 'uretiliyor' then 'bekliyor' else shorts_durum end,
       shorts_baslik, shorts_url, shorts_youtube_id, shorts_yayin_zamani, shorts_hata
from youtube_bolumler
where shorts_durum is not null
on conflict (bolum_id, sira) do nothing;

-- Taşınan bölümler için 2. Shorts
insert into youtube_shorts (bolum_id, sira)
select id, 2 from youtube_bolumler where shorts_durum is not null
on conflict (bolum_id, sira) do nothing;

-- Eski sütunlar boşaltılır: eski stüdyo kodu (güncelleme gelene kadar) aynı işi ikinci kez yapmasın
update youtube_bolumler set shorts_durum = null where shorts_durum is not null;

-- Harcama kaydında yeni kalem: Shorts fragmanı
alter table youtube_maliyet drop constraint if exists youtube_maliyet_kalem_check;
alter table youtube_maliyet add constraint youtube_maliyet_kalem_check
  check (kalem in ('arastirma', 'senaryo', 'ses', 'sahne', 'kapak', 'metin', 'shorts'));

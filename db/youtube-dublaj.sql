-- Ablam YouTube: dublaj — aynı videoya başka dilde ses parçası (YouTube "çok dilli ses"), şimdilik Korece.
-- Stüdyo Türkçe bölüm yayına (planlı) girince o dilde metni yeniden yazar, seslendirir, videonun süresine
-- tamamlar; başlık/açıklama ve altyazıyı API ile videoya ekler. Ses dosyası ve o dildeki kapak Drive'a konur:
-- YouTube Studio > Altyazılar > video > dil > Ses / Küçük resim "Ekle" ile elle yüklenir (API'si yok).
-- durum: bekliyor | uretiliyor | hazir (Studio'ya yüklenecek) | yuklendi | hata

create table if not exists youtube_dublajlar (
  id           uuid primary key default gen_random_uuid(),
  bolum_id     uuid not null references youtube_bolumler(id) on delete cascade,
  dil          text not null default 'ko',
  durum        text not null default 'bekliyor',
  ilerleme     int  default 0,
  adim         text,
  baslik       text,
  senaryo_md   text,
  kelime       int,
  sure_sn      double precision,
  drive_url    text,
  kapak_url    text,
  onizleme_url text,
  gunluk       text[] default '{}',
  hata         text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now(),
  unique (bolum_id, dil)
);

drop trigger if exists youtube_dublajlar_set_updated_at on youtube_dublajlar;
create trigger youtube_dublajlar_set_updated_at
  before update on youtube_dublajlar for each row execute function update_updated_at();

alter table youtube_dublajlar enable row level security;
drop policy if exists "youtube_dublajlar_public_all" on youtube_dublajlar;
create policy "youtube_dublajlar_public_all" on youtube_dublajlar for all using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'youtube_dublajlar') then
    alter publication supabase_realtime add table youtube_dublajlar;
  end if;
end $$;

-- Harcama kaydında yeni kalem: dublaj
alter table youtube_maliyet drop constraint if exists youtube_maliyet_kalem_check;
alter table youtube_maliyet add constraint youtube_maliyet_kalem_check
  check (kalem in ('arastirma', 'senaryo', 'ses', 'sahne', 'kapak', 'metin', 'shorts', 'dublaj'));

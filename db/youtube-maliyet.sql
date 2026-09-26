-- Ablam YouTube: harcama kaydı (sitede yalnızca adresle açılan /youtube/maliyet).
-- Stüdyo her ücretli işten sonra bir satır yazar: dil modelleri OpenRouter'ın bildirdiği gerçek tutarla,
-- ses/sahne/kapak config [maliyet] fiyat listesiyle. tahmini = eski günlüklerden sonradan çıkarılmış kayıt.
create table if not exists youtube_maliyet (
  id        uuid primary key default gen_random_uuid(),
  zaman     timestamptz not null default now(),
  kalem     text not null check (kalem in ('arastirma', 'senaryo', 'ses', 'sahne', 'kapak', 'metin')),
  tutar     numeric(10, 4) not null,
  bolum_id  uuid references youtube_bolumler(id) on delete set null,
  sahne_id  uuid references youtube_sahneler(id) on delete set null,
  aciklama  text,
  tahmini   boolean not null default false
);
create index if not exists youtube_maliyet_zaman on youtube_maliyet (zaman desc);

alter table youtube_maliyet enable row level security;
drop policy if exists "youtube_maliyet_public_all" on youtube_maliyet;
create policy "youtube_maliyet_public_all" on youtube_maliyet for all using (true) with check (true);

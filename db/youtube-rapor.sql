-- Ablam YouTube: haftalık rapor. Stüdyo her pazartesi son 7 günün YouTube verisini toplar, dil modeli yorumlayıp
-- öneriler yazar (gece/rapor.py); sitede "Rapor" sekmesinde görünür. Maliyet bilgisi içermez.
create table if not exists youtube_raporlar (
  id         uuid primary key default gen_random_uuid(),
  hafta      date not null unique,   -- haftanın pazartesisi
  metin      text,                   -- markdown (## başlıklar, "- " maddeler)
  veri       jsonb,                  -- raporun dayandığı ham veri
  created_at timestamptz default now()
);

alter table youtube_raporlar enable row level security;
drop policy if exists "youtube_raporlar_public_all" on youtube_raporlar;
create policy "youtube_raporlar_public_all" on youtube_raporlar for all using (true) with check (true);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'youtube_raporlar') then
    alter publication supabase_realtime add table youtube_raporlar;
  end if;
end $$;

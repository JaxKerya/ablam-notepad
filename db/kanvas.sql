-- Ablam Kanvas: sonsuz, ortak çizim tahtaları (17.10.2026).
-- Bir kez çalıştırılır; tekrar çalıştırmak zararsız.
--
-- Canlı eşitleme Supabase Realtime "broadcast" ile (kanal: kanvas-<id>), tablo
-- yalnızca kalıcı kayıt: sayfa açılınca ve bağlantı koptuktan sonra buradan okunuyor.
-- Bu yüzden tabloların realtime yayınına (publication) eklenmesi gerekmiyor.

create table if not exists kanvaslar (
  id          uuid primary key default gen_random_uuid(),
  ad          text not null,
  desen       text not null default 'kareli',  -- kareli | noktali | bos (uygulama yeni kanvası "bos" açıyor)
  ton         text not null default 'koyu',    -- koyu | acik
  olusturan   text,                            -- profil: ablam | ozi
  onizleme    text,                            -- listedeki küçük resim (JPEG data URL)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Her çizgi, şekil, yazı ve resim ayrı bir satır. Kimliği tarayıcı üretiyor: çizen
-- kişi kaydı beklemeden karşı tarafa aynı kimlikle yayınlayabilsin diye.
create table if not exists kanvas_ogeler (
  id          uuid primary key,
  kanvas_id   uuid not null references kanvaslar(id) on delete cascade,
  tur         text not null,                   -- kalem | sekil | yazi | resim
  veri        jsonb not null,
  sira        double precision not null,       -- üst üste binme sırası
  olusturan   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists kanvas_ogeler_kanvas_sira on kanvas_ogeler (kanvas_id, sira);

-- RLS — diğer bölümlerle aynı desen (site giriş kapısının arkasında)
alter table kanvaslar enable row level security;
drop policy if exists "kanvaslar_public_all" on kanvaslar;
create policy "kanvaslar_public_all" on kanvaslar
  for all using (true) with check (true);

alter table kanvas_ogeler enable row level security;
drop policy if exists "kanvas_ogeler_public_all" on kanvas_ogeler;
create policy "kanvas_ogeler_public_all" on kanvas_ogeler
  for all using (true) with check (true);

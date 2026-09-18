-- Ablam Kariyer — yapay zekâ destekli, tam otomatik iş ilanı takibi
-- Supabase SQL Editor'da bu dosyanın tamamını çalıştırın. Yeniden çalıştırmak güvenlidir.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profil — tek kişi için, tek satır (id her zaman 1).
--
-- serbest_metin: ablamın kendi cümleleriyle yazdığı. profil: modelin bundan
-- çıkardığı yapılandırılmış hâl — ablam düzenleyebilir, eşleştirme BUNU okur.
-- Şehirler / uzaktan / maaş ayrı kolon: bunlar yargı değil sert filtre, model
-- çağrılmadan uygulanır. Şehir birden fazla olabilir (Ankara + İstanbul gibi);
-- boş dizi = her yer.
-- ---------------------------------------------------------------------------
create table if not exists kariyer_profil (
  id               integer primary key default 1 check (id = 1),
  serbest_metin    text,
  profil           jsonb,
  sehirler         text[] not null default '{}',
  uzaktan_olur     boolean not null default true,
  asgari_maas      integer,                 -- TL, boşsa filtre yok
  calisma_sekli    text[] not null default '{}',  -- tam | yari | uzaktan | staj
  bildirim_eposta  text,
  updated_at       timestamptz default now()
);

insert into kariyer_profil (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- İlanlar — kaynaktan bağımsız tek tablo. parmak_izi tekilleştirme anahtarı:
-- aynı ilan iki sitede çıkınca ikinci kez değerlendirilmesin, ikinci kez
-- bildirilmesin.
-- ---------------------------------------------------------------------------
create table if not exists kariyer_ilanlar (
  id            uuid primary key default gen_random_uuid(),
  kaynak        text not null,             -- iskur | ilangov | linkedin | jooble | careerjet | ...
  kaynak_id     text,                      -- kaynaktaki kimlik (varsa)
  parmak_izi    text not null unique,
  baslik        text not null,
  sirket        text,
  sehir         text,
  aciklama      text,
  url           text,
  yayin_tarihi  date,
  son_basvuru   date,
  ham           jsonb,                     -- kaynaktan gelen ham kayıt, ayıklama için
  gorulme       timestamptz default now()
);

create index if not exists kariyer_ilanlar_gorulme_idx on kariyer_ilanlar (gorulme desc);
create index if not exists kariyer_ilanlar_kaynak_idx  on kariyer_ilanlar (kaynak, kaynak_id);

-- ---------------------------------------------------------------------------
-- Eşleşmeler — her değerlendirilen ilana bir satır. Puan 0-100, karar puandan
-- eşiklerle türetiliyor (lib/kariyer.ts). geri_bildirim ablamdan: "ilgilenmedim"
-- dedikleri sonraki değerlendirmelere olumsuz örnek olarak giriyor.
-- ---------------------------------------------------------------------------
create table if not exists kariyer_eslesmeler (
  ilan_id           uuid primary key references kariyer_ilanlar(id) on delete cascade,
  puan              integer not null check (puan between 0 and 100),
  gerekce           text,
  uyusan            text[] not null default '{}',
  uyusmayan         text[] not null default '{}',
  karar             text not null,          -- bildir | ozet | listele | ele
  bildirildi        timestamptz,
  geri_bildirim     text,                   -- ilgilendim | ilgilenmedim
  geri_bildirim_notu text,
  geri_bildirim_ts  timestamptz,
  olcum             jsonb,                  -- token, maliyet, model
  degerlendirildi   timestamptz default now()
);

create index if not exists kariyer_eslesmeler_karar_idx on kariyer_eslesmeler (karar, degerlendirildi desc);

-- ---------------------------------------------------------------------------
-- Taramalar — izleme. "Sistem çalışıyor mu" sorusunun cevabı buradan okunur;
-- bir kaynak kırılınca sessiz kalmasın, hata satırı düşsün ve uyarı gitsin.
-- ---------------------------------------------------------------------------
create table if not exists kariyer_taramalar (
  id         uuid primary key default gen_random_uuid(),
  kaynak     text not null,
  baslangic  timestamptz not null default now(),
  bitis      timestamptz,
  bulunan    integer not null default 0,    -- kaynakta görülen
  yeni       integer not null default 0,    -- daha önce görülmemiş
  hata       text
);

create index if not exists kariyer_taramalar_baslangic_idx on kariyer_taramalar (baslangic desc);

-- ---------------------------------------------------------------------------
-- updated_at tetikleyicisi (notes tablosundaki fonksiyonu yeniden kullanır)
-- ---------------------------------------------------------------------------
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists kariyer_profil_set_updated_at on kariyer_profil;
create trigger kariyer_profil_set_updated_at
  before update on kariyer_profil
  for each row execute function update_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — site giriş kapısının arkasında, diğer tablolarla aynı desen
-- ---------------------------------------------------------------------------
alter table kariyer_profil     enable row level security;
alter table kariyer_ilanlar    enable row level security;
alter table kariyer_eslesmeler enable row level security;
alter table kariyer_taramalar  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['kariyer_profil', 'kariyer_ilanlar', 'kariyer_eslesmeler', 'kariyer_taramalar']
  loop
    execute format('drop policy if exists "%s_public_all" on %I', t, t);
    execute format(
      'create policy "%s_public_all" on %I for all using (true) with check (true)', t, t
    );
  end loop;
end $$;

-- Ablam Ders: kategorilerin sırası (ders listesindeki "Kategorileri sırala")
-- 07.10.2026. Bir kez çalıştırılır; tekrar çalıştırmak zararsız.
--
-- Satırı olmayan kategori (yeni eklenen) sıralananların altında, sabit düzende
-- listelenir. Tablo yokken sayfa çalışmaya devam eder, yalnızca sıra kaydedilemez.
create table if not exists ders_kategori_sira (
  kategori   text primary key,
  sira       integer not null,
  updated_at timestamptz not null default now()
);

-- RLS — ders tablolarıyla aynı desen (site giriş kapısının arkasında)
alter table ders_kategori_sira enable row level security;
drop policy if exists "ders_kategori_sira_public_all" on ders_kategori_sira;
create policy "ders_kategori_sira_public_all" on ders_kategori_sira
  for all using (true) with check (true);

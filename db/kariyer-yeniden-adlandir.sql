-- Ablam Kariyer — eski "is_*" tablolarını "kariyer_*" olarak yeniden adlandırır.
-- YALNIZCA db/is.sql ile kurulmuş, içinde veri olan bir kurulumda çalıştırın.
-- Sıfırdan kurulumda gerek yok: db/kariyer.sql doğrudan yeni adlarla kurar.
-- Veri, yabancı anahtar, RLS politikaları ve tetikleyici tabloyla birlikte taşınır;
-- indeks ve tetikleyici adları ayrıca yenileniyor ki kariyer.sql ile aynı olsun.

alter table if exists is_profil     rename to kariyer_profil;
alter table if exists is_ilanlar    rename to kariyer_ilanlar;
alter table if exists is_eslesmeler rename to kariyer_eslesmeler;
alter table if exists is_taramalar  rename to kariyer_taramalar;

alter index if exists is_ilanlar_gorulme_idx     rename to kariyer_ilanlar_gorulme_idx;
alter index if exists is_ilanlar_kaynak_idx      rename to kariyer_ilanlar_kaynak_idx;
alter index if exists is_eslesmeler_karar_idx    rename to kariyer_eslesmeler_karar_idx;
alter index if exists is_taramalar_baslangic_idx rename to kariyer_taramalar_baslangic_idx;

alter trigger is_profil_set_updated_at on kariyer_profil rename to kariyer_profil_set_updated_at;

-- Politika adları "is_*_public_all" kalmıştı; kariyer.sql'dekiyle eşitle
do $$
declare t text;
begin
  foreach t in array array['profil', 'ilanlar', 'eslesmeler', 'taramalar']
  loop
    execute format('alter policy "is_%s_public_all" on kariyer_%s rename to "kariyer_%s_public_all"', t, t, t);
  end loop;
end $$;

-- PostgREST şema önbelleğini yenile — yoksa arayüz eski adları görmeye devam eder
notify pgrst, 'reload schema';

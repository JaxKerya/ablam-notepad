-- Ablam Kariyer — 20.09.2026: ilan güvenilirliği + başvuru takibi
-- Supabase SQL Editor'da tek seferde çalıştır. Geriye uyumlu: yeni kolonlar boş/varsayılan.

-- 1) İlan güvenilirliği (kırmızı bayrak). Model puanlamayla birlikte döndürür;
--    kritik bayrakta puan ≤ 40 (asla bildirilmez), orta bayrakta ≤ 74 (telefona düşmez).
alter table kariyer_eslesmeler
  add column if not exists uyarilar text[] not null default '{}',   -- kısa etiketler: "Eğitim ücreti istiyor"
  add column if not exists risk     text;                            -- kritik | orta | null

-- 2) Başvuru takibi. Ablam "Başvurdum" der; durumu kendisi günceller.
--    Akşam özeti 10. günden itibaren 7 günde bir "cevap yok, takip et" hatırlatır.
alter table kariyer_eslesmeler
  add column if not exists basvuru_durumu     text,          -- basvurdu | gorusme | olumsuz | kabul | null
  add column if not exists basvuru_ts         timestamptz,   -- başvuru günü
  add column if not exists basvuru_guncelleme timestamptz,   -- son durum değişikliği
  add column if not exists basvuru_hatirlatma timestamptz;   -- son hatırlatma e-postası

create index if not exists kariyer_eslesmeler_basvuru_idx on kariyer_eslesmeler (basvuru_durumu) where basvuru_durumu is not null;

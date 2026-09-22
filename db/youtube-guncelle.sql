-- Ablam YouTube: yayındaki videonun başlık/açıklamasını YouTube'da güncelleme.
-- Site düzenleyip kaydedince true olur; stüdyo videos.update çağırır ve bayrağı kapatır.
alter table youtube_bolumler add column if not exists yt_guncelle boolean not null default false;
